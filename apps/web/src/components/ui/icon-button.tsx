import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({
  label,
  children,
  className = '',
  type = 'button',
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`nav-item inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
