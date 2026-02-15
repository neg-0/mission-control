// Placeholder component to satisfy build
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Button = ({ children, onClick, variant, size, className }: any) => (
  <button onClick={onClick} className={`btn ${variant} ${size} ${className || ''}`}>{children}</button>
);
