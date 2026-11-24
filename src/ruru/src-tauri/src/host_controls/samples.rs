use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

use super::system::{Phase, Wall};

const WINDOW: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(super) struct Cpu {
    invocation: String,
    samples: VecDeque<(Instant, u64)>,
}

impl Cpu {
    pub(super) fn sample(&mut self, wall: &Wall, now: Instant) -> Option<f64> {
        let Some(counter) = wall.cpu.filter(|_| wall.phase == Phase::Running) else {
            self.samples.clear();
            return (wall.phase == Phase::Stopped).then_some(0.0);
        };
        if self.invocation != wall.invocation
            || self
                .samples
                .back()
                .is_some_and(|&(_, previous)| previous > counter)
        {
            self.samples.clear();
            self.invocation.clone_from(&wall.invocation);
        }
        self.samples.push_back((now, counter));
        let cutoff = now - WINDOW;
        while self
            .samples
            .get(1)
            .is_some_and(|&(second, _)| second <= cutoff)
        {
            self.samples.pop_front();
        }
        let &(first, base) = self.samples.front()?;
        if first > cutoff {
            return Some(0.0);
        }
        let elapsed = now.duration_since(first).as_nanos() as f64;
        let mut baseline = base as f64;
        if let Some(&(second, value)) = self.samples.get(1)
            && second > first
        {
            baseline += (value - base) as f64
                * cutoff
                    .duration_since(first)
                    .div_duration_f64(second.duration_since(first));
        }
        debug_assert!(elapsed >= WINDOW.as_nanos() as f64);
        Some((counter as f64 - baseline) / WINDOW.as_nanos() as f64 * 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn averages_a_whole_window_and_resets_at_restart_and_stop() {
        let mut cpu = Cpu::default();
        let start = Instant::now();
        let mut wall = Wall {
            phase: Phase::Running,
            invocation: "1".into(),
            cpu: Some(0),
            memory: Some(1024),
            failure: None,
        };
        assert_eq!(cpu.sample(&wall, start), Some(0.0));
        wall.cpu = Some(40_000_000_000);
        assert_eq!(
            cpu.sample(&wall, start + Duration::from_secs(20)),
            Some(0.0)
        );
        wall.cpu = Some(80_000_000_000);
        assert_eq!(
            cpu.sample(&wall, start + Duration::from_secs(40)),
            Some(200.0)
        );
        wall.invocation = "2".into();
        assert_eq!(
            cpu.sample(&wall, start + Duration::from_secs(41)),
            Some(0.0)
        );
        wall.phase = Phase::Changing;
        assert_eq!(cpu.sample(&wall, start + Duration::from_secs(42)), None);
        wall.phase = Phase::Stopped;
        assert_eq!(
            cpu.sample(&wall, start + Duration::from_secs(43)),
            Some(0.0)
        );
    }
}
