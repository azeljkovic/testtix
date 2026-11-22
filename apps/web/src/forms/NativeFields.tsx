import { type ReactNode, useId } from 'react';
import { type Control, Controller, type FieldValues, type Path } from 'react-hook-form';

// Native `<select>`, `<input type="datetime-local">` and checkboxes bound to React Hook Form, for
// the admin forms. Native controls (as in the catalogue filters, C2.3) behave the same in jsdom and
// browsers and are what testers expect to drive. Labels, help text and errors are linked by ID.

const CONTROL_CLASS =
  'rounded-md border border-slate-400 bg-white px-3 py-2 text-slate-900 aria-invalid:border-red-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600';
const LABEL_CLASS = 'font-medium text-slate-900';
const DESCRIPTION_CLASS = 'text-sm text-slate-600';
const ERROR_CLASS = 'text-sm font-medium text-red-700';

interface NativeFieldProps<Values extends FieldValues, Transformed = Values> {
  /** `Transformed`: what the resolver turns the values into (the API request). */
  control: Control<Values, unknown, Transformed>;
  name: Path<Values>;
  label: string;
  description?: ReactNode;
  isDisabled?: boolean;
}

function describedBy(...ids: (string | false)[]): string | undefined {
  const present = ids.filter((id) => id !== false);
  return present.length === 0 ? undefined : present.join(' ');
}

export function SelectField<Values extends FieldValues, Transformed = Values>({
  control,
  name,
  label,
  description,
  isDisabled = false,
  children,
}: NativeFieldProps<Values, Transformed> & { children: ReactNode }) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className={LABEL_CLASS}>
            {label}
          </label>
          <select
            id={id}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={isDisabled}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={describedBy(
              description !== undefined && `${id}-description`,
              fieldState.error !== undefined && `${id}-error`,
            )}
            className={CONTROL_CLASS}
          >
            {children}
          </select>
          {description !== undefined && (
            <p id={`${id}-description`} className={DESCRIPTION_CLASS}>
              {description}
            </p>
          )}
          {fieldState.error !== undefined && (
            <p id={`${id}-error`} className={ERROR_CLASS}>
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
}

/** A date and time (no time zone) as `YYYY-MM-DDTHH:mm`. */
export function DateTimeField<Values extends FieldValues, Transformed = Values>({
  control,
  name,
  label,
  description,
  isDisabled = false,
}: NativeFieldProps<Values, Transformed>) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className={LABEL_CLASS}>
            {label}
          </label>
          <input
            id={id}
            ref={field.ref}
            type="datetime-local"
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={isDisabled}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={describedBy(
              description !== undefined && `${id}-description`,
              fieldState.error !== undefined && `${id}-error`,
            )}
            className={CONTROL_CLASS}
          />
          {description !== undefined && (
            <p id={`${id}-description`} className={DESCRIPTION_CLASS}>
              {description}
            </p>
          )}
          {fieldState.error !== undefined && (
            <p id={`${id}-error`} className={ERROR_CLASS}>
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
}

export function CheckboxField<Values extends FieldValues, Transformed = Values>({
  control,
  name,
  label,
  description,
  isDisabled = false,
}: NativeFieldProps<Values, Transformed>) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start gap-2">
          <input
            id={id}
            ref={field.ref}
            type="checkbox"
            name={field.name}
            checked={field.value}
            onChange={(event) => {
              field.onChange(event.target.checked);
            }}
            onBlur={field.onBlur}
            disabled={isDisabled}
            aria-describedby={description === undefined ? undefined : `${id}-description`}
            className="mt-1 size-4 accent-indigo-700"
          />
          <div className="flex flex-col">
            <label htmlFor={id} className={LABEL_CLASS}>
              {label}
            </label>
            {description !== undefined && (
              <p id={`${id}-description`} className={DESCRIPTION_CLASS}>
                {description}
              </p>
            )}
          </div>
        </div>
      )}
    />
  );
}
