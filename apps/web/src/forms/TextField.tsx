import { FieldError, Input, Label, Text, TextField as AriaTextField } from 'react-aria-components';
import { type Control, Controller, type FieldValues, type Path } from 'react-hook-form';

interface TextFieldProps<Values extends FieldValues> {
  control: Control<Values>;
  name: Path<Values>;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  /** Help text under the input, linked to it with `aria-describedby`. */
  description?: string;
}

/**
 * A labelled text input bound to a React Hook Form field. React Aria links the label, description and
 * error message to the input and sets `aria-invalid`; validation itself is the form's Zod schema.
 */
export function TextField<Values extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  description,
}: TextFieldProps<Values>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <AriaTextField
          name={field.name}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          isDisabled={field.disabled}
          isInvalid={fieldState.invalid}
          // Report errors through ARIA only; the browser's own validation bubbles stay out of the way.
          validationBehavior="aria"
          type={type}
          autoComplete={autoComplete}
          className="flex flex-col gap-1"
        >
          <Label className="font-medium text-slate-900">{label}</Label>
          <Input
            ref={field.ref}
            className="rounded-md border border-slate-400 bg-white px-3 py-2 text-slate-900 data-[invalid]:border-red-700"
          />
          {description !== undefined && (
            <Text slot="description" className="text-sm text-slate-600">
              {description}
            </Text>
          )}
          <FieldError className="text-sm font-medium text-red-700">
            {fieldState.error?.message}
          </FieldError>
        </AriaTextField>
      )}
    />
  );
}
