import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axe } from '../testing/axe.js';
import { concert, meetup } from '../testing/catalogue-fixtures.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { concertSeatMap, fixtureSeatId, meetupSeatMap } from '../testing/seat-fixtures.js';
import { mockSeatMap, withSeatStatus } from '../testing/seats.js';

const CONCERT_SEATS = '/events/midnight-echoes-live/seats';
const MEETUP_TICKETS = '/events/flaky-tests-clinic/seats';
const MIXED_SEATS = '/events/harbour-lights/seats';

async function stalls() {
  return screen.findByRole('grid', { name: 'Stalls' });
}

/** The Stalls seat in `row` and `number`, found by the start of its accessible name. */
function stallsSeat(row: string, number: number) {
  return screen.getByRole('gridcell', {
    name: new RegExp(`^Stalls, row ${row}, seat ${number.toString()},`),
  });
}

/** Tabs into the Stalls grid from the link above the page heading. */
async function tabIntoStalls(user: { tab: () => Promise<void> }) {
  screen.getByRole('link', { name: '‹ Back to the event' }).focus();
  await user.tab();
}

function announcement() {
  return screen.getByRole('status').textContent.trim();
}

function chosenTickets() {
  const list = screen.queryByRole('list', { name: 'Chosen tickets' });
  if (list === null) return [];
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.firstChild?.textContent);
}

function summaryFigures() {
  const summary = within(screen.getByRole('region', { name: 'Your selection' }));
  return summary.getAllByRole('definition').map((dd) => dd.textContent);
}

describe('seat map page', () => {
  it('shows the seat key, the stage and a labelled grid per seated section the event sells', async () => {
    renderApp(CONCERT_SEATS);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose seats' }),
    ).toBeInTheDocument();
    await expect.poll(() => document.title).toBe('Choose seats: Midnight Echoes Live · TestTix');
    await stalls();

    const key = within(screen.getByRole('region', { name: 'Seat key' }));
    expect(key.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1Available',
      'Selected',
      'Held',
      'Sold',
      'Not on sale',
    ]);
    expect(screen.getByText('Stage')).toBeInTheDocument();

    // The Boxes belong to the venue, but the event doesn't sell them.
    expect(screen.getAllByRole('grid')).toHaveLength(2);
    expect(screen.getByRole('grid', { name: 'Balcony' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Boxes' })).not.toBeInTheDocument();
    expect(screen.getByText('10 of 15 seats available · $89.00')).toBeInTheDocument();
  });

  it('labels rows and gives every seat a name with its price and status', async () => {
    renderApp(CONCERT_SEATS);
    const grid = within(await stalls());

    expect(grid.getAllByRole('rowheader').map((header) => header.textContent)).toEqual([
      'Row A',
      'Row B',
      'Row C',
    ]);
    const rowA = within(grid.getAllByRole('row')[0] ?? document.body);
    expect(rowA.getAllByRole('gridcell').map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Stalls, row A, seat 1, $89.00, sold',
      'Stalls, row A, seat 2, $89.00, sold',
      'Stalls, row A, seat 3, $89.00, available',
      'Stalls, row A, seat 4, $89.00, available',
      'Stalls, row A, seat 5, $89.00, held',
    ]);
    expect(stallsSeat('C', 4)).toHaveAccessibleName('Stalls, row C, seat 4, not on sale');

    // Available seats can be selected; the others are disabled.
    expect(stallsSeat('A', 3)).toHaveAttribute('aria-selected', 'false');
    expect(stallsSeat('A', 1)).toHaveAttribute('aria-disabled', 'true');
    expect(stallsSeat('A', 1)).not.toHaveAttribute('aria-selected');
    expect(screen.getByRole('grid', { name: 'Stalls' })).toHaveAttribute(
      'aria-multiselectable',
      'true',
    );
  });

  it('is one tab stop per grid, starting on the first available seat, with arrow-key navigation', async () => {
    const { user } = renderApp(CONCERT_SEATS);
    await stalls();

    await tabIntoStalls(user);
    expect(stallsSeat('A', 3)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(stallsSeat('A', 4)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(stallsSeat('B', 4)).toHaveFocus();
    await user.keyboard('{End}');
    expect(stallsSeat('B', 5)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(stallsSeat('B', 5)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(stallsSeat('B', 1)).toHaveFocus();
    await user.keyboard('{Control>}{End}{/Control}');
    expect(stallsSeat('C', 5)).toHaveFocus();
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(stallsSeat('A', 1)).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(stallsSeat('A', 1)).toHaveFocus();

    // Only the focused seat is in the tab order: Tab leaves the grid, Shift+Tab comes back to it.
    expect(screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)).toHaveLength(2); // one per grid
    await user.tab();
    expect(
      within(screen.getByRole('grid', { name: 'Balcony' })).getAllByRole('gridcell')[0],
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(stallsSeat('A', 1)).toHaveFocus();
  });

  it('toggles seats with Enter, Space and clicks, and announces each change with the total', async () => {
    const { user } = renderApp(CONCERT_SEATS);
    await stalls();
    expect(screen.getByText('No tickets chosen yet.')).toBeInTheDocument();

    await tabIntoStalls(user);
    await user.keyboard('{Enter}');
    expect(stallsSeat('A', 3)).toHaveAttribute('aria-selected', 'true');
    expect(stallsSeat('A', 3)).toHaveAccessibleName('Stalls, row A, seat 3, $89.00, selected');
    expect(announcement()).toBe('Added Stalls, row A, seat 3. 1 ticket, $89.00 in total.');

    await user.keyboard('{ArrowDown} ');
    expect(stallsSeat('B', 3)).toHaveAttribute('aria-selected', 'true');
    expect(announcement()).toBe('Added Stalls, row B, seat 3. 2 tickets, $178.00 in total.');

    await user.click(stallsSeat('C', 1));
    expect(chosenTickets()).toEqual([
      'Stalls, row A, seat 3',
      'Stalls, row B, seat 3',
      'Stalls, row C, seat 1',
    ]);
    expect(summaryFigures()).toEqual(['3 of 6', '$267.00']);

    await user.keyboard(' ');
    expect(stallsSeat('C', 1)).toHaveAttribute('aria-selected', 'false');
    expect(announcement()).toBe('Removed Stalls, row C, seat 1. 2 tickets, $178.00 in total.');
    expect(summaryFigures()).toEqual(['2 of 6', '$178.00']);
  });

  it('ignores seats that are sold, held or not on sale', async () => {
    const { user } = renderApp(CONCERT_SEATS);
    await stalls();

    await user.click(stallsSeat('A', 1));
    await user.keyboard('{Enter}');
    await user.click(stallsSeat('A', 5));
    await user.click(stallsSeat('C', 5));

    expect(stallsSeat('C', 5)).toHaveFocus();
    expect(chosenTickets()).toEqual([]);
    expect(announcement()).toBe('');
  });

  it('stops at the order’s ticket limit and says so', async () => {
    const { user } = renderApp(CONCERT_SEATS);
    await stalls();

    for (const number of [1, 2, 3, 4, 5]) await user.click(stallsSeat('B', number));
    await user.click(stallsSeat('A', 3));
    expect(summaryFigures()).toEqual(['6 of 6', '$534.00']);
    expect(
      screen.getByText('You’ve reached the limit of 6 tickets per order.'),
    ).toBeInTheDocument();

    await user.click(stallsSeat('A', 4));
    expect(stallsSeat('A', 4)).toHaveAttribute('aria-selected', 'false');
    expect(announcement()).toBe('You can hold at most 6 tickets at a time.');
    // Trying again announces it again (the text changes invisibly).
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status').textContent).toBe(
      'You can hold at most 6 tickets at a time. ',
    );
  });

  it('removes tickets from the summary and moves the focus to its heading', async () => {
    const { user } = renderApp(CONCERT_SEATS);
    await stalls();
    await user.click(stallsSeat('B', 1));
    await user.click(stallsSeat('B', 2));

    await user.click(screen.getByRole('button', { name: 'Remove Stalls, row B, seat 1' }));
    expect(chosenTickets()).toEqual(['Stalls, row B, seat 2']);
    expect(stallsSeat('B', 1)).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'Your selection' })).toHaveFocus();
    expect(announcement()).toBe('Removed Stalls, row B, seat 1. 1 ticket, $89.00 in total.');

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(chosenTickets()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Your selection' })).toHaveFocus();
    expect(announcement()).toBe('Selection cleared. 0 tickets, $0.00 in total.');
  });

  it('drops seats someone else took when the map is refreshed', async () => {
    let map = concertSeatMap;
    mockSeatMap(concert.id, () => map);
    const { user, queryClient } = renderApp(CONCERT_SEATS);
    await stalls();
    await user.click(stallsSeat('B', 1));
    await user.click(stallsSeat('B', 2));

    map = withSeatStatus(concertSeatMap, [fixtureSeatId(1, 'B', 1)], 'HELD');
    await queryClient.invalidateQueries({ queryKey: ['seats'] });

    await waitFor(() => {
      expect(stallsSeat('B', 1)).toHaveAccessibleName('Stalls, row B, seat 1, $89.00, held');
    });
    expect(chosenTickets()).toEqual(['Stalls, row B, seat 2']);
  });

  it('shows the seats read-only while the event isn’t on sale', async () => {
    mockSeatMap(concert.id, () => ({ ...concertSeatMap, availability: 'SALES_ENDED' }));
    const { user } = renderApp(CONCERT_SEATS);
    const grid = await stalls();

    expect(
      screen.getByText(/This event has started, so tickets are no longer sold\./),
    ).toBeInTheDocument();
    expect(grid).toHaveAttribute('aria-readonly', 'true');
    expect(grid).not.toHaveAttribute('aria-multiselectable');
    expect(stallsSeat('A', 3)).not.toHaveAttribute('aria-selected');

    await user.click(stallsSeat('A', 3));
    await user.keyboard('{Enter}');
    expect(chosenTickets()).toEqual([]);
  });

  it('says when the event doesn’t exist', async () => {
    renderApp('/events/no-such-event/seats');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Event not found' }),
    ).toBeInTheDocument();
  });

  it('offers a retry when the seat map fails to load', async () => {
    let fail = true;
    mockSeatMap(concert.id, () => (fail ? problemResponse({ status: 500 }) : concertSeatMap));
    const { user } = renderApp(CONCERT_SEATS);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side. Please try again.');

    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await stalls()).toBeInTheDocument();
  });
});

describe('general admission', () => {
  it('has a labelled quantity stepper limited to the places left', async () => {
    const { user } = renderApp(MEETUP_TICKETS);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose tickets' }),
    ).toBeInTheDocument();
    const stepper = await screen.findByRole('spinbutton', { name: 'Loft tickets' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Seat key' })).not.toBeInTheDocument();
    expect(stepper).toHaveValue('0');
    expect(stepper).toHaveAttribute('aria-valuemin', '0');
    expect(stepper).toHaveAttribute('aria-valuemax', '3');
    expect(stepper).toHaveAccessibleDescription(
      '3 tickets left · $10.00 – $15.00, cheapest first · up to 3 for this order',
    );

    const add = screen.getByRole('button', { name: 'Add a Loft ticket' });
    const remove = screen.getByRole('button', { name: 'Remove a Loft ticket' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    await user.click(add);
    expect(announcement()).toBe('Loft: 1 ticket. 1 ticket, $10.00 in total.');
    await user.click(add);
    await user.click(add);
    expect(stepper).toHaveValue('3');
    expect(stepper).toHaveAttribute('aria-valuenow', '3');
    // At the limit the button stays focusable but does nothing.
    expect(add).toHaveAttribute('aria-disabled', 'true');
    await user.click(add);
    expect(stepper).toHaveValue('3');
    expect(add).toHaveFocus();

    expect(chosenTickets()).toEqual(['Loft, 3 tickets']);
    // Two places at $10.00, then one at $15.00.
    expect(summaryFigures()).toEqual(['3 of 4', '$35.00']);

    await user.click(remove);
    expect(stepper).toHaveValue('2');
    expect(summaryFigures()).toEqual(['2 of 4', '$20.00']);
  });

  it('takes the arrow keys and typed quantities, within the limits', async () => {
    const { user } = renderApp(MEETUP_TICKETS);
    const stepper = await screen.findByRole('spinbutton', { name: 'Loft tickets' });

    await user.click(stepper);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(stepper).toHaveValue('2');
    await user.keyboard('{ArrowDown}');
    expect(stepper).toHaveValue('1');
    await user.keyboard('{End}');
    expect(stepper).toHaveValue('3');
    await user.keyboard('{Home}');
    expect(stepper).toHaveValue('0');
    await user.keyboard('{PageUp}');
    expect(stepper).toHaveValue('3');
    // The spin button's own value is read out; the live region stays quiet.
    expect(announcement()).toBe('');

    // Typed quantities are kept within the limits when committed.
    await user.clear(stepper);
    await user.type(stepper, '9');
    await user.tab();
    expect(stepper).toHaveValue('3');
    expect(chosenTickets()).toEqual(['Loft, 3 tickets']);
    await user.clear(stepper);
    await user.type(stepper, '2{Enter}');
    expect(stepper).toHaveValue('2');
    // Something that isn't a number leaves the quantity as it was.
    await user.clear(stepper);
    await user.type(stepper, 'abc');
    await user.tab();
    expect(stepper).toHaveValue('2');
  });

  it('is disabled when no places are left', async () => {
    mockSeatMap(meetup.id, () => ({
      ...meetupSeatMap,
      sections: meetupSeatMap.sections.map((section) => ({
        ...section,
        available: 0,
        prices: [],
      })),
    }));
    renderApp(MEETUP_TICKETS);

    const stepper = await screen.findByRole('spinbutton', { name: 'Loft tickets' });
    expect(stepper).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a Loft ticket' })).toBeDisabled();
    expect(stepper).toHaveAccessibleDescription('None left right now.');
  });
});

describe('mixed events', () => {
  it('shows seat grids and GA steppers that share the ticket limit', async () => {
    const { user } = renderApp(MIXED_SEATS);

    const grid = await screen.findByRole('grid', { name: 'Mezzanine' });
    const stepper = screen.getByRole('spinbutton', { name: 'Standing Floor tickets' });
    expect(stepper).toHaveAttribute('aria-valuemax', '6');

    await user.click(within(grid).getByRole('gridcell', { name: /^Mezzanine, row A, seat 2,/ }));
    await user.click(within(grid).getByRole('gridcell', { name: /^Mezzanine, row B, seat 1,/ }));
    expect(stepper).toHaveAttribute('aria-valuemax', '4');

    await user.click(stepper);
    await user.keyboard('{End}');
    expect(stepper).toHaveValue('4');
    expect(chosenTickets()).toEqual([
      'Mezzanine, row A, seat 2',
      'Mezzanine, row B, seat 1',
      'Standing Floor, 4 tickets',
    ]);
    expect(summaryFigures()).toEqual(['6 of 6', '$190.00']);

    // The limit is reached, so another seat isn't added.
    await user.click(within(grid).getByRole('gridcell', { name: /^Mezzanine, row A, seat 3,/ }));
    expect(announcement()).toBe('You can hold at most 6 tickets at a time.');
  });
});

describe('seat map accessibility (axe)', () => {
  it.each([
    ['a seated event with a selection', CONCERT_SEATS],
    ['a general admission event', MEETUP_TICKETS],
    ['a mixed event', MIXED_SEATS],
  ])('%s has no axe violations', async (_, path) => {
    const { user } = renderApp(path);
    await screen.findByRole('region', { name: 'Your selection' });
    if (path === CONCERT_SEATS) {
      await user.click(stallsSeat('B', 2));
      await screen.findByRole('list', { name: 'Chosen tickets' });
    }
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('a read-only seat map has no axe violations', async () => {
    mockSeatMap(concert.id, () => ({ ...concertSeatMap, availability: 'SOLD_OUT' }));
    renderApp(CONCERT_SEATS);
    await stalls();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
