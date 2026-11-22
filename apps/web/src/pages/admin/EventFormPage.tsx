import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateEventRequest,
  CreateEventRequestSchema,
  EVENT_CATEGORIES,
  HOLD_DURATION_SEC,
  MAX_TICKETS_PER_ORDER,
} from '@testtix/shared';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';

import {
  changedEventFields,
  convertEventForm,
  type EventFormValues,
  eventFormValues,
} from '../../admin/event-form.js';
import { LINK_CLASS } from '../../admin/format.js';
import { adminQueries, eventChanged } from '../../admin/queries.js';
import {
  type AdminEvent,
  type AdminEventVenue,
  type AdminVenueSummary,
  createEvent,
  updateEvent,
} from '../../api/admin.js';
import { CATEGORY_LABELS } from '../../catalogue/format.js';
import { FormAlert } from '../../forms/FormAlert.js';
import { errorMessage, formLevelError, showSubmitError } from '../../forms/form-errors.js';
import { DateTimeField, SelectField } from '../../forms/NativeFields.js';
import { requestResolver } from '../../forms/request-resolver.js';
import { SubmitButton } from '../../forms/SubmitButton.js';
import { TextField } from '../../forms/TextField.js';
import { PageTitle } from '../../layout/PageTitle.js';
import { AdminNotFound } from './AdminNotFound.js';

const FIELDS = [
  'title',
  'slug',
  'performer',
  'description',
  'category',
  'venueId',
  'startsAt',
  'endsAt',
  'salesOpenAt',
  'holdDurationSec',
  'maxTicketsPerOrder',
] as const;

/** `/admin/events/new` */
export function NewEventPage() {
  const venues = useQuery(adminQueries.venueOptions());
  return (
    <>
      <PageTitle title="Admin: new event" />
      <Link to="/admin/events" className={LINK_CLASS}>
        ‹ All events
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">New event</h1>
      <p className="mt-2 text-slate-600">
        The event starts as a draft. Release a batch of tickets, then publish it.
      </p>
      {venues.isPending ? (
        <p role="status" className="mt-6 text-slate-600">
          Loading venues…
        </p>
      ) : venues.isError ? (
        <LoadError message={errorMessage(venues.error)} retry={() => void venues.refetch()} />
      ) : (
        <EventForm venues={venues.data} />
      )}
    </>
  );
}

/** `/admin/events/:eventId/edit` */
export function EditEventPage() {
  const { eventId = '' } = useParams();
  const event = useQuery(adminQueries.event(eventId));
  const venues = useQuery(adminQueries.venueOptions());

  if (event.isError) {
    return <AdminNotFound what="event" error={event.error} retry={() => void event.refetch()} />;
  }
  return (
    <>
      <PageTitle
        title={event.data === undefined ? 'Admin: edit event' : `Edit ${event.data.title}`}
      />
      <Link to={`/admin/events/${eventId}`} className={LINK_CLASS}>
        ‹ Back to the event
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Edit event</h1>
      {event.isPending || venues.isPending ? (
        <p role="status" className="mt-6 text-slate-600">
          Loading…
        </p>
      ) : venues.isError ? (
        <LoadError message={errorMessage(venues.error)} retry={() => void venues.refetch()} />
      ) : event.data.status === 'CANCELLED' ? (
        <p className="mt-6 text-slate-700">A cancelled event can’t be changed.</p>
      ) : (
        <EventForm venues={venues.data} event={event.data} />
      )}
    </>
  );
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="mt-6 flex flex-col items-start gap-2 text-red-900">
      <p className="font-medium">We couldn’t load the venues. {message}</p>
      <button type="button" onClick={retry} className={LINK_CLASS}>
        Try again
      </button>
    </div>
  );
}

interface EventFormProps {
  venues: AdminVenueSummary[];
  /** The event to edit; a new event without it. */
  event?: AdminEvent;
}

function EventForm({ venues, event }: EventFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The event's venue stays a choice even when it isn't among the venues listed.
  const venueChoices: AdminEventVenue[] =
    event === undefined || venues.some((venue) => venue.id === event.venue.id)
      ? venues
      : [...venues, event.venue];
  const timeZoneOf = (venueId: string) =>
    venueChoices.find((venue) => venue.id === venueId)?.timezone;

  const { control, handleSubmit, setError, formState } = useForm<
    EventFormValues,
    unknown,
    CreateEventRequest
  >({
    resolver: requestResolver(CreateEventRequestSchema, (values) =>
      convertEventForm(values, timeZoneOf(values.venueId)),
    ),
    defaultValues: eventFormValues(event),
  });
  const venueId = useWatch({ control, name: 'venueId' });
  const timeZone = timeZoneOf(venueId);
  const venueLocked = event !== undefined && event.batches.length > 0;

  const save = useMutation({
    mutationFn: async (request: CreateEventRequest) => {
      if (event === undefined) return createEvent(request);
      const original = CreateEventRequestSchema.safeParse(
        convertEventForm(eventFormValues(event), event.venue.timezone).request,
      );
      return updateEvent(
        event.id,
        original.success ? changedEventFields(request, original.data) : request,
      );
    },
    onSuccess: async (saved) => {
      await eventChanged(queryClient, saved);
      await navigate(`/admin/events/${saved.id}`);
    },
  });

  const onSubmit = handleSubmit(async (request) => {
    try {
      await save.mutateAsync(request);
    } catch (error) {
      showSubmitError(error, setError, FIELDS, {
        SLUG_TAKEN: 'That slug is taken. Choose another, or leave it empty to make one.',
      });
    }
  });
  const formError = formLevelError(formState.errors);

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="mt-8 flex max-w-2xl flex-col gap-5"
    >
      {formError !== undefined && <FormAlert>{formError}</FormAlert>}
      <TextField control={control} name="title" label="Title" />
      <TextField
        control={control}
        name="slug"
        label="Slug (optional)"
        description="The event’s address: /events/your-slug. Lowercase letters, digits and hyphens. Leave it empty to make one from the title."
      />
      <TextField
        control={control}
        name="performer"
        label="Performer"
        description="Artist, speaker or host. Searched together with the title."
      />
      <TextField control={control} name="description" label="Description" multiline />
      <SelectField control={control} name="category" label="Category">
        {EVENT_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </option>
        ))}
      </SelectField>
      <SelectField
        control={control}
        name="venueId"
        label="Venue"
        isDisabled={venueLocked}
        description={
          venueLocked
            ? 'The venue can’t change once tickets have been released.'
            : venueChoices.length === 0
              ? 'There are no venues yet. Add one under Venues first.'
              : undefined
        }
      >
        <option value="">Choose a venue</option>
        {venueChoices.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.name}, {venue.city}
          </option>
        ))}
      </SelectField>

      <fieldset className="flex flex-col gap-5 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 font-semibold text-slate-900">When</legend>
        <p className="text-sm text-slate-600">
          {timeZone === undefined
            ? 'Times are in the venue’s time zone. Choose a venue first.'
            : `Times are in the venue’s time zone, ${timeZone}.`}
        </p>
        <DateTimeField control={control} name="startsAt" label="Starts" />
        <DateTimeField control={control} name="endsAt" label="Ends" />
        <DateTimeField
          control={control}
          name="salesOpenAt"
          label="Sales open"
          description="Before the start. Each batch can also be released later."
        />
      </fieldset>

      <fieldset className="flex flex-col gap-5 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 font-semibold text-slate-900">Ticket rules</legend>
        <TextField
          control={control}
          name="holdDurationSec"
          label="Hold duration in seconds (optional)"
          inputMode="numeric"
          description={`How long seats stay held during checkout: ${String(HOLD_DURATION_SEC.min)}–${String(HOLD_DURATION_SEC.max)}. Default ${String(HOLD_DURATION_SEC.default)}.`}
        />
        <TextField
          control={control}
          name="maxTicketsPerOrder"
          label="Tickets per order (optional)"
          inputMode="numeric"
          description={`Most tickets in one order: ${String(MAX_TICKETS_PER_ORDER.min)}–${String(MAX_TICKETS_PER_ORDER.max)}. Default ${String(MAX_TICKETS_PER_ORDER.default)}.`}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton isPending={formState.isSubmitting}>
          {event === undefined ? 'Create event' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  );
}
