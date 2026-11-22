import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateVenueRequest,
  CreateVenueRequestSchema,
  LOCALE,
  type SectionType,
  type UpdateVenueRequest,
  VENUE_LIMITS,
} from '@testtix/shared';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmButton } from '../../admin/ConfirmButton.js';
import { BUTTON_CLASS, LINK_CLASS } from '../../admin/format.js';
import { adminQueries, venueChanged } from '../../admin/queries.js';
import {
  convertVenueForm,
  emptySection,
  type VenueFormValues,
  venueFormValues,
} from '../../admin/venue-form.js';
import { type AdminVenue, createVenue, deleteVenue, updateVenue } from '../../api/admin.js';
import { SECTION_TYPE_LABELS } from '../../catalogue/format.js';
import { FormAlert } from '../../forms/FormAlert.js';
import { errorMessage, formLevelError, showSubmitError } from '../../forms/form-errors.js';
import { SelectField } from '../../forms/NativeFields.js';
import { requestResolver } from '../../forms/request-resolver.js';
import { SubmitButton } from '../../forms/SubmitButton.js';
import { TextField } from '../../forms/TextField.js';
import { PageTitle } from '../../layout/PageTitle.js';
import { AdminNotFound } from './AdminNotFound.js';

const FIELDS = ['name', 'slug', 'address', 'city', 'timezone'] as const;

/** `/admin/venues/new` */
export function NewVenuePage() {
  return (
    <>
      <PageTitle title="Admin: new venue" />
      <Link to="/admin/venues" className={LINK_CLASS}>
        ‹ All venues
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">New venue</h1>
      <VenueForm />
    </>
  );
}

/** `/admin/venues/:venueId`: edit a venue, or delete it while no event uses it. */
export function EditVenuePage() {
  const { venueId = '' } = useParams();
  const venue = useQuery(adminQueries.venue(venueId));

  if (venue.isPending) {
    return (
      <p role="status" className="text-slate-600">
        Loading venue…
      </p>
    );
  }
  if (venue.isError) {
    return <AdminNotFound what="venue" error={venue.error} retry={() => void venue.refetch()} />;
  }
  return (
    <>
      <PageTitle title={`Edit ${venue.data.name}`} />
      <Link to="/admin/venues" className={LINK_CLASS}>
        ‹ All venues
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{venue.data.name}</h1>
      <DeleteVenue venue={venue.data} />
      {/* Remounts with fresh values when the saved venue comes back. */}
      <VenueForm key={venue.data.id} venue={venue.data} />
    </>
  );
}

function DeleteVenue({ venue }: { venue: AdminVenue }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteVenue(venue.id),
    onSuccess: async () => {
      await navigate('/admin/venues', { flushSync: true });
      queryClient.removeQueries({ queryKey: adminQueries.venue(venue.id).queryKey });
      await venueChanged(queryClient);
    },
  });
  return (
    <div className="mt-4 flex flex-col items-start gap-3">
      {remove.isError && (
        <FormAlert>
          {errorMessage(remove.error, {
            VENUE_IN_USE: 'Events use this venue, so it can’t be deleted.',
          })}
        </FormAlert>
      )}
      <ConfirmButton
        label="Delete venue"
        title="Delete this venue?"
        confirmLabel="Delete venue"
        dismissLabel="Keep venue"
        isDisabled={remove.isPending}
        onConfirm={() => {
          remove.mutate();
        }}
      >
        <p>The venue and its seats are deleted. This can’t be undone.</p>
      </ConfirmButton>
    </div>
  );
}

function VenueForm({ venue }: { venue?: AdminVenue }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const layoutLocked = venue?.layoutLocked ?? false;
  const { control, handleSubmit, setError, formState } = useForm<
    VenueFormValues,
    unknown,
    CreateVenueRequest
  >({
    resolver: requestResolver(CreateVenueRequestSchema, convertVenueForm),
    defaultValues: venueFormValues(venue),
  });
  const sections = useFieldArray({ control, name: 'sections' });
  const sectionTypes = useWatch({ control, name: 'sections' }).map((section) => section.type);

  const save = useMutation({
    mutationFn: async (request: CreateVenueRequest) => {
      if (venue === undefined) return createVenue(request);
      return updateVenue(venue.id, changedVenueFields(request, venue));
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(adminQueries.venue(saved.id).queryKey, saved);
      await venueChanged(queryClient);
      await navigate('/admin/venues');
    },
  });

  const onSubmit = handleSubmit(async (request) => {
    try {
      await save.mutateAsync(request);
    } catch (error) {
      showSubmitError(error, setError, FIELDS, {
        SLUG_TAKEN: 'That slug is taken. Choose another, or leave it empty to make one.',
        LAYOUT_LOCKED:
          'Tickets have been released at this venue since you opened it, so the layout can no longer change.',
      });
    }
  });
  const formError = formLevelError(formState.errors);
  const sectionsError =
    formState.errors.sections?.root?.message ?? formState.errors.sections?.message;

  const addSection = (type: SectionType) => {
    sections.append(emptySection(type), {
      focusName: `sections.${String(sections.fields.length)}.name`,
    });
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="mt-8 flex max-w-2xl flex-col gap-5"
    >
      {formError !== undefined && <FormAlert>{formError}</FormAlert>}
      <TextField control={control} name="name" label="Name" />
      <TextField
        control={control}
        name="slug"
        label="Slug (optional)"
        description="Lowercase letters, digits and hyphens. Leave it empty to make one from the name."
      />
      <TextField control={control} name="address" label="Address" />
      <TextField control={control} name="city" label="City" />
      <TextField
        control={control}
        name="timezone"
        label="Time zone"
        description="IANA time zone, e.g. America/New_York or Europe/Paris. Event times are entered and shown in it."
      />

      <fieldset
        aria-describedby={sectionsError === undefined ? undefined : 'venue-sections-error'}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4"
      >
        <legend className="px-1 font-semibold text-slate-900">Layout</legend>
        {layoutLocked && venue !== undefined ? (
          <>
            <p className="text-slate-700">
              Tickets have been released for an event here, so the layout can no longer change.
            </p>
            <ul className="list-disc pl-6 text-slate-700">
              {venue.sections.map((section) => (
                <li key={section.id}>
                  {section.name}: {SECTION_TYPE_LABELS[section.type].toLowerCase()},{' '}
                  {section.capacity.toLocaleString(LOCALE)}{' '}
                  {section.type === 'SEATED' ? 'seats' : 'places'}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Seated sections are a grid of rows (lettered from the front) and seats (numbered from
              1). General admission sections have a capacity. Up to {VENUE_LIMITS.sections} sections
              and {VENUE_LIMITS.totalCapacity.toLocaleString(LOCALE)} people in all.
              {venue !== undefined && ' Saving a changed layout replaces every section and seat.'}
            </p>
            {sections.fields.map((field, index) => (
              <fieldset
                key={field.id}
                className="flex flex-col gap-4 rounded-md border border-slate-200 bg-slate-50 p-4"
              >
                <legend className="px-1 font-medium text-slate-900">Section {index + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    control={control}
                    name={`sections.${index}.name`}
                    label="Section name"
                  />
                  <SelectField control={control} name={`sections.${index}.type`} label="Type">
                    <option value="SEATED">{SECTION_TYPE_LABELS.SEATED}</option>
                    <option value="GA">{SECTION_TYPE_LABELS.GA}</option>
                  </SelectField>
                  {sectionTypes[index] === 'GA' ? (
                    <TextField
                      control={control}
                      name={`sections.${index}.capacity`}
                      label="Capacity"
                      inputMode="numeric"
                      description={`1–${VENUE_LIMITS.gaCapacity.toLocaleString(LOCALE)} people`}
                    />
                  ) : (
                    <>
                      <TextField
                        control={control}
                        name={`sections.${index}.rows`}
                        label="Rows"
                        inputMode="numeric"
                        description={`1–${String(VENUE_LIMITS.rowsPerSection)}`}
                      />
                      <TextField
                        control={control}
                        name={`sections.${index}.seatsPerRow`}
                        label="Seats per row"
                        inputMode="numeric"
                        description={`1–${String(VENUE_LIMITS.seatsPerRow)}`}
                      />
                    </>
                  )}
                </div>
                {sections.fields.length > 1 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        sections.remove(index);
                      }}
                      className={BUTTON_CLASS}
                    >
                      Remove section {index + 1}
                    </button>
                  </div>
                )}
              </fieldset>
            ))}
            {sectionsError !== undefined && (
              <p
                id="venue-sections-error"
                role="alert"
                className="text-sm font-medium text-red-700"
              >
                {sectionsError}
              </p>
            )}
            {sections.fields.length < VENUE_LIMITS.sections && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    addSection('SEATED');
                  }}
                  className={BUTTON_CLASS}
                >
                  Add seated section
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addSection('GA');
                  }}
                  className={BUTTON_CLASS}
                >
                  Add general admission section
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>

      <div>
        <SubmitButton isPending={formState.isSubmitting}>
          {venue === undefined ? 'Create venue' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  );
}

/** The update body: the fields that changed, and the layout only when it changed. */
function changedVenueFields(request: CreateVenueRequest, venue: AdminVenue): UpdateVenueRequest {
  const original = CreateVenueRequestSchema.safeParse(
    convertVenueForm(venueFormValues(venue)).request,
  );
  if (!original.success) return request;
  const changes: UpdateVenueRequest = {};
  if (request.name !== original.data.name) changes.name = request.name;
  if (request.slug !== undefined && request.slug !== original.data.slug)
    changes.slug = request.slug;
  if (request.address !== original.data.address) changes.address = request.address;
  if (request.city !== original.data.city) changes.city = request.city;
  if (request.timezone !== original.data.timezone) changes.timezone = request.timezone;
  if (
    !venue.layoutLocked &&
    JSON.stringify(request.sections) !== JSON.stringify(original.data.sections)
  ) {
    changes.sections = request.sections;
  }
  return changes;
}
