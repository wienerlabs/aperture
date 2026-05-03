'use client';

/**
 * ApField — Antimetal-styled form primitives used throughout the dashboard
 * forms. Mirrors the floating-label / helper-text pattern popularised by
 * originui (21st.dev/r/originui/input) but keeps every style decision
 * grounded in our existing tokens:
 *  - Sharp 0px inputs (Antimetal "deliberate austerity")
 *  - Black ink text + black borders + brand-orange focus ring
 *  - Host Grotesk label + helper text, tighter tracking
 *
 * Each component is a thin, accessible wrapper. They keep the native
 * `<input>` API surface so existing controlled-state code in PoliciesTab
 * keeps working without changing onChange / value plumbing.
 */

import { forwardRef, useId, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface FieldShellProps {
  readonly label?: ReactNode;
  readonly helper?: ReactNode;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: ReactNode;
  readonly htmlFor?: string;
  readonly className?: string;
}

export function FieldShell({
  label,
  helper,
  error,
  required,
  children,
  htmlFor,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium tracking-tighter text-black/65 uppercase"
        >
          {label}
          {required && <span className="ml-0.5 text-aperture-dark">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="text-[12px] text-red-600 tracking-tighter">{error}</span>
      ) : helper ? (
        <span className="text-[12px] text-black/55 tracking-tighter">{helper}</span>
      ) : null}
    </div>
  );
}

type ApInputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly label?: ReactNode;
  readonly helper?: ReactNode;
  readonly error?: string;
  readonly leadingIcon?: ReactNode;
  readonly trailingAdornment?: ReactNode;
  readonly fieldClassName?: string;
};

export const ApInput = forwardRef<HTMLInputElement, ApInputProps>(function ApInput(
  { label, helper, error, leadingIcon, trailingAdornment, className, fieldClassName, id, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `ap-input-${generatedId}`;
  return (
    <FieldShell
      label={label}
      helper={helper}
      error={error}
      required={required}
      htmlFor={inputId}
      className={fieldClassName}
    >
      <div
        className={cn(
          'group relative flex items-center w-full bg-white transition-colors',
          // Antimetal: 0px input radius, hard black border, orange on focus.
          'border border-black/30 focus-within:border-aperture',
          // Subtle inner shadow so the field feels recessed against the
          // surrounding ap-card surface.
          'shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]',
          error && 'border-red-500 focus-within:border-red-500',
        )}
      >
        {leadingIcon && (
          <span className="pl-3 text-black/45 [&>svg]:h-4 [&>svg]:w-4">{leadingIcon}</span>
        )}
        <input
          ref={ref}
          id={inputId}
          required={required}
          className={cn(
            'flex-1 min-w-0 bg-transparent px-3 py-2.5 text-[14px] text-black tracking-tighter',
            'placeholder:text-black/35 focus:outline-none disabled:opacity-50',
            className,
          )}
          {...rest}
        />
        {trailingAdornment && (
          <span className="pr-3 text-black/55 text-[12px] tracking-tighter">
            {trailingAdornment}
          </span>
        )}
      </div>
    </FieldShell>
  );
});

type ApTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  readonly label?: ReactNode;
  readonly helper?: ReactNode;
  readonly error?: string;
};

export const ApTextarea = forwardRef<HTMLTextAreaElement, ApTextareaProps>(
  function ApTextarea({ label, helper, error, className, id, required, ...rest }, ref) {
    const generatedId = useId();
    const inputId = id ?? `ap-textarea-${generatedId}`;
    return (
      <FieldShell
        label={label}
        helper={helper}
        error={error}
        required={required}
        htmlFor={inputId}
      >
        <textarea
          ref={ref}
          id={inputId}
          required={required}
          className={cn(
            'w-full bg-white px-3 py-2.5 text-[14px] text-black tracking-tighter',
            'border border-black/30 focus:border-aperture focus:outline-none',
            'placeholder:text-black/35 resize-y min-h-[88px]',
            error && 'border-red-500 focus:border-red-500',
            className,
          )}
          {...rest}
        />
      </FieldShell>
    );
  },
);

interface ApCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
}

export function ApCheckbox({ label, description, className, id, ...rest }: ApCheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? `ap-check-${generatedId}`;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'group flex items-start gap-3 cursor-pointer rounded-[14px] border border-black/8 bg-white px-3 py-2.5 transition-colors',
        'hover:border-aperture/40',
        rest.checked && 'border-aperture/60 bg-[rgba(248,179,0,0.04)]',
        className,
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        className="peer mt-0.5 h-4 w-4 cursor-pointer accent-[#f8b300]"
        {...rest}
      />
      <span className="flex flex-col">
        <span className="text-[14px] font-medium text-black tracking-tighter">{label}</span>
        {description && (
          <span className="text-[12px] text-black/55 tracking-tighter">{description}</span>
        )}
      </span>
    </label>
  );
}

interface ApFieldsetProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function ApFieldset({ title, description, children }: ApFieldsetProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <div>
        <legend className="font-display text-[16px] tracking-[-0.005em] text-black">
          {title}
        </legend>
        {description && (
          <p className="text-[12px] text-black/55 tracking-tighter mt-1 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {children}
    </fieldset>
  );
}
