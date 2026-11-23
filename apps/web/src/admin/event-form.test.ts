import { CreateEventRequestSchema } from '@testtix/shared';
import { describe, expect, it } from 'vitest';

import { publishedEvent } from '../testing/admin-fixtures.js';
import {
  changedEventFields,
  convertEventForm,
  EVENT_FORM_MESSAGES,
  eventFormValues,
} from './event-form.js';

const NEW_YORK = 'America/New_York';

describe('event form', () => {
  it('converts an event to form values and back', () => {
    const values = eventFormValues(publishedEvent);
    expect(values.startsAt).toBe('2026-12-12T23:30');
    const request = CreateEventRequestSchema.parse(convertEventForm(values, NEW_YORK).request);
    expect(request).toMatchObject({
      slug: publishedEvent.slug,
      startsAt: publishedEvent.startsAt,
      endsAt: publishedEvent.endsAt,
      salesOpenAt: publishedEvent.salesOpenAt,
      holdDurationSec: 300,
      maxTicketsPerOrder: 4,
      waitingRoomEnabled: false,
      admissionRatePerSec: 10,
      admissionTokenTtlSec: 600,
    });
  });

  it('asks for a venue before reading times', () => {
    const values = { ...eventFormValues(), startsAt: '2027-01-09T20:00' };
    expect(convertEventForm(values, undefined).errors).toEqual({
      startsAt: EVENT_FORM_MESSAGES.venueFirst,
    });
  });

  it('leaves empty optional fields out', () => {
    const { request } = convertEventForm(eventFormValues(), NEW_YORK);
    expect(request).not.toHaveProperty('slug');
    expect(request).not.toHaveProperty('holdDurationSec');
    expect(request).not.toHaveProperty('admissionRatePerSec');
    // A checkbox is never empty: it is always sent, so an edit can turn the waiting room off.
    expect(request).toHaveProperty('waitingRoomEnabled', false);
    expect(request).not.toHaveProperty('startsAt');
  });

  it('lists the changed fields only', () => {
    const original = CreateEventRequestSchema.parse(
      convertEventForm(eventFormValues(publishedEvent), NEW_YORK).request,
    );
    expect(changedEventFields(original, original)).toEqual({});
    expect(
      changedEventFields({ ...original, title: 'New', maxTicketsPerOrder: 2 }, original),
    ).toEqual({ title: 'New', maxTicketsPerOrder: 2 });
  });
});
