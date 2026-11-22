import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALE, type ReleaseBatchRequest, ReleaseBatchRequestSchema } from '@testtix/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';

import {
  type BatchFormValues,
  batchFormValues,
  type BatchSection,
  batchSections,
  convertBatchForm,
} from '../../admin/batch-form.js';
import { LINK_CLASS } from '../../admin/format.js';
import { adminQueries, eventChanged } from '../../admin/queries.js';
import { type AdminEvent, releaseBatch } from '../../api/admin.js';
import { SECTION_TYPE_LABELS } from '../../catalogue/format.js';
import { FormAlert } from '../../forms/FormAlert.js';
import { errorMessage, formLevelError, showSubmitError } from '../../forms/form-errors.js';
import { CheckboxField, DateTimeField } from '../../forms/NativeFields.js';
import { requestResolver } from '../../forms/request-resolver.js';
import { SubmitButton } from '../../forms/SubmitButton.js';
import { TextField } from '../../forms/TextField.js';
import { PageTitle } from '../../layout/PageTitle.js';
import { AdminNotFound } from './AdminNotFound.js';

/** `/admin/events/:eventId/batches/new`: puts seats and GA places on sale at one price. */
export function ReleaseBatchPage() {
  const { eventId = '' } = useParams();
  const event = useQuery(adminQueries.event(eventId));
  const venue = useQuery({
    ...adminQueries.venue(event.data?.venue.id ?? ''),
    enabled: event.data !== undefined,
  });

  if (event.isError) {
    return <AdminNotFound what="event" error={event.error} retry={() => void event.refetch()} />;
  }
  return (
    <>
      <PageTitle
        title={
          event.data === undefined ? 'Release tickets' : `Release tickets: ${event.data.title}`
        }
      />
      <Link to={`/admin/events/${eventId}`} className={LINK_CLASS}>
        ‹ Back to the event
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Release tickets</h1>
      {event.data !== undefined && (
        <p className="mt-1 text-lg text-slate-700">{event.data.title}</p>
      )}
      {event.isPending || venue.isPending ? (
        <p role="status" className="mt-6 text-slate-600">
          Loading…
        </p>
      ) : venue.isError ? (
        <div role="alert" className="mt-6 flex flex-col items-start gap-2 text-red-900">
          <p className="font-medium">We couldn’t load the venue. {errorMessage(venue.error)}</p>
          <button type="button" onClick={() => void venue.refetch()} className={LINK_CLASS}>
            Try again
          </button>
        </div>
      ) : event.data.status === 'CANCELLED' ? (
        <p className="mt-6 text-slate-700">A cancelled event can’t get new tickets.</p>
      ) : (
        <BatchForm event={event.data} sections={batchSections(venue.data, event.data)} />
      )}
    </>
  );
}

function BatchForm({ event, sections }: { event: AdminEvent; sections: BatchSection[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timeZone = event.venue.timezone;
  const { control, handleSubmit, setError, formState } = useForm<
    BatchFormValues,
    unknown,
    ReleaseBatchRequest
  >({
    resolver: requestResolver(ReleaseBatchRequestSchema, (values) =>
      convertBatchForm(values, sections, timeZone),
    ),
    defaultValues: batchFormValues(sections),
  });

  const release = useMutation({
    mutationFn: (request: ReleaseBatchRequest) => releaseBatch(event.id, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueries.event(event.id).queryKey });
      await eventChanged(queryClient);
      await navigate(`/admin/events/${event.id}`);
    },
  });

  const onSubmit = handleSubmit(async (request) => {
    try {
      await release.mutateAsync(request);
    } catch (error) {
      showSubmitError(error, setError, ['name', 'releasesAt']);
    }
  });
  const formError = formLevelError(formState.errors);
  const sectionsError =
    formState.errors.sections?.root?.message ?? formState.errors.sections?.message;
  const nothingLeft = sections.every((section) => section.unreleased === 0);

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="mt-8 flex max-w-2xl flex-col gap-5"
    >
      {formError !== undefined && <FormAlert>{formError}</FormAlert>}
      <TextField
        control={control}
        name="name"
        label="Batch name"
        description="Shown to admins only, e.g. “Early bird” or “Balcony”."
      />
      <TextField
        control={control}
        name="price"
        label="Price per ticket (USD)"
        inputMode="decimal"
        description="In dollars, e.g. 25 or 25.50. Enter 0 for free tickets."
      />
      <DateTimeField
        control={control}
        name="releasesAt"
        label="On sale from (optional)"
        description={`In the venue’s time zone, ${timeZone}. Leave it empty to release the tickets now. Either way, they sell only once the event’s sales open.`}
      />

      <fieldset
        aria-describedby={sectionsError === undefined ? undefined : 'batch-sections-error'}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4"
      >
        <legend className="px-1 font-semibold text-slate-900">Tickets to release</legend>
        <p className="text-sm text-slate-600">
          Seated sections are released whole: every seat no earlier batch released. General
          admission sections are released by number of places.
        </p>
        {nothingLeft && (
          <p className="font-medium text-slate-800">
            Every ticket at {event.venue.name} has been released for this event.
          </p>
        )}
        {sections.map((section, index) =>
          section.type === 'SEATED' ? (
            <CheckboxField
              key={section.id}
              control={control}
              name={`sections.${index}.selected`}
              label={section.name}
              isDisabled={section.unreleased === 0}
              description={unreleasedText(section)}
            />
          ) : section.unreleased === 0 ? (
            <div key={section.id}>
              <p className="font-medium text-slate-900">{section.name}</p>
              <p className="text-sm text-slate-600">{unreleasedText(section)}</p>
            </div>
          ) : (
            <TextField
              key={section.id}
              control={control}
              name={`sections.${index}.quantity`}
              label={`${section.name}: places to release`}
              inputMode="numeric"
              description={unreleasedText(section)}
            />
          ),
        )}
        {sectionsError !== undefined && (
          <p id="batch-sections-error" role="alert" className="text-sm font-medium text-red-700">
            {sectionsError}
          </p>
        )}
      </fieldset>

      <div>
        <SubmitButton isPending={formState.isSubmitting}>Release tickets</SubmitButton>
      </div>
    </form>
  );
}

/** "Seated · 120 of 200 seats not released yet". */
function unreleasedText(section: BatchSection): string {
  const unit = section.type === 'SEATED' ? 'seats' : 'places';
  const left =
    section.unreleased === 0
      ? `all ${section.capacity.toLocaleString(LOCALE)} ${unit} released`
      : `${section.unreleased.toLocaleString(LOCALE)} of ${section.capacity.toLocaleString(LOCALE)} ${unit} not released yet`;
  return `${SECTION_TYPE_LABELS[section.type]} · ${left}`;
}
