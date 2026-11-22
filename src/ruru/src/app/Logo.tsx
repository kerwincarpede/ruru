/** The Ruru owl, drawn in the theme's colours so it follows light and dark mode. */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <path
        className="logo-body"
        d="M14 10 L22 18 Q32 14 42 18 L50 10 L50 30 Q52 52 32 56 Q12 52 14 30 Z"
      />
      <circle className="logo-eye" cx="24" cy="30" r="8" />
      <circle className="logo-eye" cx="40" cy="30" r="8" />
      <circle className="logo-pupil" cx="24" cy="30" r="3.5" />
      <circle className="logo-pupil" cx="40" cy="30" r="3.5" />
      <path className="logo-beak" d="M29 38 L35 38 L32 44 Z" />
    </svg>
  );
}

export default Logo;
