# TestTix testing guide

How to test TestTix from the outside: what the API promises, and the hooks it gives testers: [test mode](#test-mode) with its [test API](#test-api-reference), the [server clock](#the-server-clock), [seed scenarios](#seed-scenarios), [test cards](#test-cards), the [polling contract](#polling-retryafterms) and [ways to keep tests independent](#keeping-tests-independent).

**The examples run as written.** Every `sh` block in this guide works against a local API in test mode (`cp .env.example .env`, `pnpm infra:up`, `pnpm db:deploy`, `pnpm --filter @testtix/api dev`), with `curl` 7.82 or later and `jq`. CI runs them all, each after a [`POST /__test/reset`](#resetting-the-data): `pnpm docs:examples` does the same against your local API (it resets the data). They work the same against the app in containers (`pnpm full:up`, see the [README](../README.md#running-everything-in-containers)), which serves the API at the same address.

## Web app basics

- URL locally: `http://localhost:5173` (`pnpm --filter @testtix/web dev`). The page calls the API on its own origin under `/api` (`/api/health` → `GET /health`).
- Every page has the same landmarks: a header (`banner`) with the main navigation (`navigation` named "Main"), one `main` and a footer (`contentinfo`). The current navigation link has `aria-current="page"`.
- The first Tab stop is a "Skip to main content" link. Activating it moves focus to `main` without changing the URL.
- Each route sets the document title to `<page> · TestTix` (just `TestTix` on the home page). Unknown paths render a "Page not found" page with that title; the server still answers 200, since routing happens in the browser.
- Locate elements by role and accessible name. `data-testid` is only added where no good accessible locator exists.

### Account pages

| Path                    | Who       | What it shows                                                                                               |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `/register`             | anyone    | Name, Email, Password. Creates a customer, logs it in and goes to `/account`                                |
| `/login`                | anyone    | Email, Password. Goes to `redirectTo` (or `/`) afterwards                                                   |
| `/verify-email?token=…` | anyone    | The landing page of the [verification email](#email-verification): verifies the token and shows the outcome |
| `/account`              | logged in | Name, email, verification status and account type; unverified users get "Send a new verification email"     |
| `/orders`               | logged in | [Your orders](#checkout-and-order-pages), newest first                                                      |
| `/orders/<order id>`    | logged in | [One order](#order-page): its status, and its tickets once confirmed                                        |
| `/admin`                | admins    | The [admin area](#admin-pages); redirects to `/admin/events`                                                |

- **Header.** Visitors see "Log in" and "Register" links, which return to the current page. A logged-in user gets a menu button named `<name>, account menu` with "Account", "Your orders", "Admin" (admins only) and "Log out". Logging out goes to the home page.
- **Guards.** A visitor opening `/account`, a waiting room, checkout or order page, or any `/admin/…` page is sent to `/login?redirectTo=<path>`. A customer opening an admin page stays on the URL and sees "Access denied". `redirectTo` must be a path on the same site; anything else (`https://…`, `//host`) is ignored and the login goes to `/`.
- **Validation.** The forms check the same rules as the API before sending anything (see [Accounts and sessions](#accounts-and-sessions)) and show the API's own messages, such as "Password must be at least 8 characters", under the field. The field gets `aria-invalid="true"`, the message is its accessible description, and the first invalid field gets focus. Errors the API reports for a field (a taken email) go to that field; others (wrong password, server or network errors) appear in an alert above the form.
- **Verification page outcomes:** "Email verified", "Verification link expired", "Verification link not valid" (unknown or replaced token), "Verification link incomplete" (no token) and an error with "Try again". The expired and invalid pages offer "Send a new verification email" to the logged-in owner, or a "Log in" link to anyone else.
- The page checks the session with `GET /api/auth/me` on load. For visitors that is a 401, which the browser console lists as a failed request; it isn't an app error.

### Event pages

| Path                      | What it shows                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/events`                 | The [public catalogue](#public-catalogue): search, filters, sort and pages                           |
| `/events/<slug>`          | One event: when and where, prices, sales details, ticket availability per section and the way to buy |
| `/events/<slug>/seats`    | The [seat map page](#seat-map-page): seat grids, GA steppers, the selection summary and the hold     |
| `/events/<slug>/queue`    | A ticket drop's [waiting room](#waiting-room-page): your place in the queue (logged in)              |
| `/events/<slug>/checkout` | The [checkout](#checkout-page): your held tickets, the time left and the way to the payment page     |

- **The URL holds the whole list state**, with the API's parameter names: `q`, `category`, `venue`, `seating`, `availability`, `sort`, `order`, `page`, plus `from` / `to` as calendar days (`2026-12-01`). So `/events?category=TALK&sort=price&order=desc&page=2` opens exactly that list, and every change (a filter, a search, a page) is a history entry the back button undoes. Defaults are left out (the plain list is `/events`). A value the API wouldn't accept (`category=PARTY`, `page=0`, `from=2026-02-30`) is ignored.
- **Debounced search.** The "Search" box (role `searchbox`, inside a `search` landmark named "Events") searches title and performer **300 ms** after the last keystroke (`SEARCH_DEBOUNCE_MS` in `packages/shared`), with one request for the whole pause. Enter searches at once. The URL gets `q` when the search runs, not while typing.
- **Filters** are native selects named "Category", "Venue" (choices from `GET /venues`), "Seating", "Availability" and "Sort by" (date, price or name, each both ways), and date inputs "From" and "To". The days are in the browser's time zone and both are included: `from=2026-12-01&to=2026-12-31` asks the API for `from` = midnight on Dec 1 and `to` = midnight on Jan 1. A "To" before "From" marks "To" invalid with a message and sends no request. Changing anything but the page goes back to page 1. "Clear filters" (shown while any search or filter is set) keeps the sort.
- **Results.** A status line above the list (`role="status"`) reads "Loading events…", "Showing 21–40 of 41 events" or "No events found"; grey placeholder cards show while loading. Each event is an `article` named by its title, whose link opens the event page; the date is in the **venue's** time zone (e.g. "Sun, Dec 13, 2026, 6:30 PM EST"), whatever the browser's is. A failed request shows an alert with "Try again".
- **Pagination** (20 per page) is a `navigation` named "Pagination" with "Previous page", "Page N" and "Next page" links; the current page has `aria-current="page"`, and "Previous page" / "Next page" have `aria-disabled="true"` and no `href` on the first / last page. Following a page link moves focus to the "Results" heading. A page past the end (`/events?page=9`) says so and links to the last page.
- **Event page.** "Back to events" returns to the list with the filters the visitor came from. The "Tickets" region shows the availability (On sale, Sold out, Not on sale yet, Sales ended); while the event is on sale it links "Choose seats" ("Choose tickets" for general-admission-only events), otherwise it says why nothing can be bought and when a scheduled batch releases tickets. A [ticket drop](#waiting-room-page) says "This is a ticket drop: …" and links "Join the queue" instead while on sale; before sales open it also has a `timer` named "Sales open in" and a "Join the waiting room" link. The "Ticket availability" table lists each section's type, price, available, held and sold counts and next release, with an "All sections" total row. An unknown, draft or cancelled event shows "Event not found".

### Seat map page

`/events/<slug>/seats` (heading "Choose seats", or "Choose tickets" for general-admission-only events) shows the sections the event sells, in the venue's order, with live statuses from [`GET /events/{eventId}/seats`](#seat-map). Anyone can open it; holding the selection needs a login.

- **Seat grids.** Each seated section is a `grid` named after the section (e.g. `getByRole('grid', { name: 'Stalls' })`), described by "10 of 15 seats available · $89.00". Each row starts with a `rowheader` ("Row A"); row A is nearest the stage. Each seat is a `gridcell` named `<section>, row <row>, seat <number>, <price>, <state>`, e.g. "Stalls, row B, seat 12, $89.00, available"; the state is `available`, `selected`, `held`, `sold` or `not on sale` (that one has no price when no batch includes the seat). Available and selected seats have `aria-selected`; the others have `aria-disabled="true"` and can be focused but not chosen.
- **Keyboard.** Each grid is one Tab stop, starting on its first available seat. Arrow keys move one seat (no wrapping; up and down keep the seat position), Home / End go to the start / end of the row, Ctrl+Home / Ctrl+End to the first / last seat of the section. Enter or Space toggles the focused seat; clicking toggles too.
- **Seat key** (a region named "Seat key"): every state has its own icon or outline as well as a colour (number, tick, clock, cross, dashed outline).
- **GA sections** have a `spinbutton` named `<section> tickets` (e.g. "Floor tickets") with `aria-valuemin="0"` and `aria-valuemax` = the places left, capped by the order limit. Arrow Up / Down change it by 1, Page Up / Down by 5, Home / End go to 0 / the maximum; a typed number is clamped when the field loses focus or on Enter, and text that isn't a number is ignored. Buttons "Add a <section> ticket" / "Remove a <section> ticket" get `aria-disabled="true"` at the limits. The description says what's left and the price, e.g. "3 tickets left · $10.00 – $15.00, cheapest first · up to 3 for this order" (a hold takes the cheapest places first).
- **"Your selection"** (a region) lists the chosen tickets ("Stalls, row B, seat 12", "Floor, 3 tickets") in venue order with prices and "Remove" buttons (named "Remove Stalls, row B, seat 12", "Remove Floor tickets"), then "Tickets" ("2 of 6") and "Total" in USD, and "Clear selection". Removing moves the focus to the "Your selection" heading.
- **Ticket limit.** Seats and GA places together can't exceed the event's `maxTicketsPerOrder`. Choosing one more seat announces "You can hold at most 6 tickets at a time." and the summary says "You’ve reached the limit of 6 tickets per order."
- **Live region.** A hidden `status` announces each change with the count and total: "Added Stalls, row A, seat 3. 1 ticket, $89.00 in total.", "Removed …", "Floor: 2 tickets. …" (for the − / + buttons), "Selection cleared. …".
- **Fresh statuses.** The map is fetched on every visit and again when the window regains focus. Seats someone else took meanwhile drop out of the selection, and GA quantities shrink to what's left.
- **Not on sale.** While the event is sold out, not on sale yet or past its sales, a note says why; the grids are `aria-readonly="true"` and the steppers disabled, but every seat's status is still shown. An unknown, draft or cancelled event shows "Event not found".

#### Hold flow

- **Hold button.** Below "Your selection", while the event is on sale: "Hold seats" ("Hold tickets" for general-admission-only events), disabled until something is chosen. A visitor who isn't logged in gets a "Log in to hold tickets" link instead, which returns to the page after login. Pressing it sends [`POST /events/{eventId}/holds`](#holding-tickets) with the selection; while the request runs the button reads "Holding…" and ignores presses (`aria-disabled="true"`).
- **The hold.** On success the summary is replaced by a region named "Your tickets are held", which gets the focus: a `timer` named "Time left" ("10:00", then "9:59", …), the "Held tickets" list ("Stalls, row B, seat 12 $89.00", "Floor, 2 tickets $20.00"), "Tickets" and "Total", a "Check out" link to the [checkout](#checkout-page) and a "Release hold" button. The live region says "2 tickets held for 10 minutes." The map is refetched (your seats now show as `held`) and is read-only while the hold lasts: to change the tickets, release the hold and choose again. An existing hold (`GET /holds/current?eventId=…`) is shown the same way when the page loads, e.g. after a reload or in a second tab.
- **Countdown.** The time left is the hold's `expiresAt` minus the **browser's** clock (`Date.now()`), worked out again on every tick, with one `setTimeout` to the next whole second. So Playwright's `page.clock` controls it completely (`await page.clock.install({ time })`, then `fastForward('09:00')` / `runFor()`), and a tab whose timers were throttled shows the right time as soon as it wakes. The server's clock decides when the hold really ends: if you move the [server clock](#the-server-clock), move the browser's to match. At "1:00" the live region says "Less than a minute left on your hold." once, and the panel turns red ("Less than a minute left. When the timer runs out, the tickets are released.").
- **Expiry.** At "0:00" the hold panel goes, an `alert` banner says "Your hold expired" ("The tickets were released, and the map now shows what’s available. …"), the selection is empty and the map is refetched. If the focus was in the hold panel it moves to the "Your selection" heading. A hold that had already expired when the page loaded expires at once.
- **Release.** "Release hold" sends `DELETE /holds/{holdId}`; the summary comes back (focused), the live region says "Hold released. The tickets are available to others again." and the map is refetched. A hold that was already gone counts as released; any other failure shows an alert in the panel and keeps the hold.
- **Conflicts.** A 409 `tickets-unavailable` shows an `alert` above the button ("Someone else got some of these tickets first, so nothing was held. …") with a list named "Tickets no longer available": the taken seats ("Stalls, row B, seat 1") and GA sections without enough places ("Floor: 1 left (you asked for 3)", or "none left"). The map is refetched, the taken seats drop out of the selection and GA quantities shrink to what's left, so pressing the button again holds the rest. Other failures show the API's message in the same place; a 409 `event-not-on-sale` also refetches the map (which then turns read-only), and a 401 says "Your session has ended. Log in again to hold tickets." and shows the login link.

### Waiting room page

A [ticket drop](#ticket-drops-and-the-waiting-room) (an event with `waitingRoomEnabled`) sells through a queue. Its event page links "Join the queue" (before sales open: "Join the waiting room") to `/events/<slug>/queue`, which needs a login.

- **Joining.** Opening the page sends [`POST /events/{eventId}/queue`](#ticket-drops-and-the-waiting-room): it joins the queue, or picks up the entry you already have (after a reload, in a second tab, or from the seat map), so leaving the page doesn't cost you your place. While it runs the page says "Joining the queue…".
- **One live region.** The level-1 heading (also the page title) and the message are in one `status` region, so every change is announced:

| `status`   | Heading                      | Message and what else the page shows                                                                                                                                                         |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRE_SALE` | "You’re in the waiting room" | "Sales open <time, venue time zone>. Everyone who joins before then gets a place in a random order …", and a `timer` named "Sales open in" ("1:59:59", "2 days, 3:04:05")                    |
| `WAITING`  | "You’re in the queue"        | "You’re number 12 in the queue." ("You’re next in the queue." at 1), and "Your place", "People in the queue" and "Estimated wait" ("About 45 seconds", "About 2 minutes", "Any moment now")  |
| `ADMITTED` | (none)                       | The page goes to the seat map at once (replacing the queue in the history)                                                                                                                   |
| `EXPIRED`  | "Your turn has ended"        | "Your time to choose tickets ran out. …", a "Join the queue again" button (a new entry at the back of the queue; focus moves to the new heading) and, if you still hold tickets, "Check out" |

- **Polling.** The page polls `GET /queue/{token}`, waiting each response's `retryAfterMs`, and stops once that is null. It pauses while the tab is hidden. A failed poll keeps the last state with "We couldn’t check for updates: … We’ll keep trying."; a token that answers 404 (you joined again elsewhere) joins again. The "Sales open in" countdown uses the **browser's** clock, like the [hold countdown](#hold-flow); at 0:00 the page polls at once. Move the browser clock along with the [server clock](#the-server-clock).
- **Other outcomes.** An event without a waiting room goes straight to its seat map. 409 `event-not-on-sale` shows "Sales have ended"; an unknown event "Event not found"; other failures "We couldn’t get you into the queue" with "Try again".
- **The seat map of a drop** (`/events/<slug>/seats`) is only for customers who were let in: anyone else (visitors too, via the login page) is sent to the waiting room. It sends the admission token in `X-Admission-Token` with the map and the hold, and shows a region "It’s your turn" with a `timer` named "Your turn ends in" (the admission's `expiresAt`, browser clock; red in the last minute). When the timer reaches 0:00, or the map or a hold answers 403 `queue-required`, the page checks your entry again; once the API says the admission has ended it goes to the waiting room, which shows "Your turn has ended". Tickets you already hold stay held, and checkout doesn't need the admission.

### Checkout and order pages

The web side of [checkout and orders](#checkout-and-orders). Every page here needs a login.

#### Checkout page

`/events/<slug>/checkout` (heading "Check out") shows your [current hold](#holding-tickets) for the event:

- **"Your tickets"** (a region) lists them as the hold panel does, in a list named "Tickets in this order", with "Tickets" and "Total". "‹ Back to the seat map" returns to the seat map, where the hold is still shown.
- **"Payment"** (a region) has a `timer` named by its label "Time left to pay", with the same countdown rules as the [hold panel](#hold-flow) (browser clock; "Less than a minute left on your hold." in the page's `status` at 1:00), and a **"Pay $50.00"** button (the total). Pressing it sends [`POST /orders`](#checkout-and-orders) `{ holdId }`; the button reads "Checking out…", then "Opening the payment page…" and ignores presses while the browser goes to the order's `paymentUrl` on the [payment page](#payment-page). Checking out the same hold again (e.g. after the browser's Back button) gets the same order and payment page.
- **Free tickets** (total $0.00): the region is named "Confirm your order" and the button "Confirm order". There is no payment page: the customer goes straight to the [order page](#order-page), which shows "Processing your payment" until the order is confirmed.
- **Unverified email.** Instead of the button: "Verify your email address", with "Send a new verification email". A 403 `email-not-verified` from the API (the session was out of date) shows "Verify your email address before you check out." and the same section.
- **Errors** appear in an `alert` above the button. A 503 `payment-provider-unavailable` says "We couldn’t reach the payment provider. Your tickets are still held: try again in a moment."; press the button again. A 409 `event-not-on-sale` says the event is no longer on sale.
- **No hold.** Without a hold for the event (none yet, released, or already paid for, including a 404 from `POST /orders`) the page says "You have no tickets on hold for this event." with links "Choose tickets" and "Your orders".
- **Expiry.** At "0:00", or on a 409 `hold-expired`, an `alert` says "Your hold expired" with "Choose tickets again"; the pay button goes.

#### Order page

`/orders/<order id>` is where the payment page returns the customer (its `returnUrl`, also behind its "Cancel and return to the shop" link), and where the [e-ticket email](#e-ticket-email) links. It shows the order's status in one `status` region holding the level-1 heading (also the page title) and a message, so screen readers announce every change:

| Status            | Heading                      | What else the page shows                                                                                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PENDING_PAYMENT` | "Waiting for your payment"   | `timer` "Time left to pay" (to `expiresAt`), "Continue to payment" (the `paymentUrl`, while there is one) and "Change tickets" |
| `PROCESSING`      | "Processing your payment"    | Nothing to do: the page updates by itself                                                                                      |
| `CONFIRMED`       | "Your tickets are confirmed" | "N tickets for <event>. We’ve emailed them to <email>." and the "Your tickets" list                                            |
| `FAILED`          | "Payment failed"             | "Choose tickets again" (the seat map) and "Back to the event"                                                                  |
| `EXPIRED`         | "Order expired"              | "Choose tickets again" and "Back to the event"                                                                                 |

- **Polling.** The page polls `GET /orders/{orderId}`, waiting each response's `retryAfterMs` before the next request, and stops once that is null (a final status). Polling pauses while the tab is hidden and resumes when it is shown. A failed poll keeps the last status on screen with "We couldn’t check for updates: … We’ll keep trying." An unpaid order whose timer reaches 0:00 is fetched again at once.
- **What you see after paying** depends on the [test card](#test-cards): with `4242…` the page may show "Waiting for your payment" or "Processing your payment" for a moment, then "Your tickets are confirmed"; the delayed-webhook card shows "Waiting for your payment" until the webhook arrives (`DELAYED_WEBHOOK_MS`); the decline cards end on "Payment failed", with the seats on sale again; the no-webhook card stays waiting until the order expires.
- **"Order summary"** (a region): the event (a link), its time in the venue's time zone, the venue, the order number (its ID) and when it was ordered (in the browser's time zone). Until the order is confirmed it lists the tickets like the checkout page ("Tickets in this order").
- **Tickets.** A confirmed order lists every ticket on its own line in "Your tickets": the place ("Stalls, row B, seat 12" or "General admission – Floor"), the price, "Ticket code <code>" and a "Download PDF" link named "Download PDF: <place>". The link is `/api/tickets/<ticket id>/pdf` ([`GET /tickets/{ticketId}/pdf`](#tickets)): a plain download that sends the session cookie.
- **Refunds.** When the order has `refundDue` (a payment arrived after the order expired or failed), a note says the payment will be refunded and no tickets were sold for it.
- An unknown order, someone else's order and an address that isn't an order ID all show "Order not found" with a link to "Your orders".

#### Your orders

`/orders` (heading "Your orders") is a table (caption "Your orders, newest first") with one row per order: the event (a link to the order page) and venue, the event's date (venue time zone), when it was ordered, the ticket count, the total and the status ("Awaiting payment", "Processing", "Confirmed", "Payment failed", "Expired"). 20 orders per page, with the same [pagination](#event-pages) links as the event list and `?page=N` in the URL. Without orders it says "You haven’t ordered any tickets yet." with "Browse events". The `confirmed-order` [scenario](#seed-scenarios) gives a customer with one confirmed order of three tickets.

### Admin pages

Admins only (log in as `admin@testtix.test`, see [Seeded accounts](#seeded-accounts)). They drive the [admin API](#admin-api), so they apply the same rules.

| Path                                      | What it shows                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/admin/events`                           | Every event (drafts and cancelled ones too) by start time, with a "Status" filter and pages   |
| `/admin/events/new`                       | The event form. Creates a draft and opens its page                                            |
| `/admin/events/<id>`                      | Details, status actions and the "Ticket batches" table with available / held / sold per batch |
| `/admin/events/<id>/edit`                 | The event form, filled in. Sends only the fields that changed (`PATCH`)                       |
| `/admin/events/<id>/batches/new`          | "Release tickets": a batch at one price, now or at a set time                                 |
| `/admin/venues`                           | Venues by name, with their sections, capacity and whether the layout is locked                |
| `/admin/venues/new`, `/admin/venues/<id>` | The venue form with its layout editor; the edit page also has "Delete venue"                  |

- **Navigation.** A `navigation` named "Admin" links "Events" and "Venues". The status filter (`/admin/events?status=DRAFT`) and the page (`&page=2`) live in the URL.
- **Times are in the venue's time zone.** The event form's "Starts", "Ends" and "Sales open" and the batch form's "On sale from" are native `datetime-local` inputs (`fill('2027-01-09T20:00')`), read as wall-clock time at the venue, which the form names ("Times are in the venue’s time zone, America/New_York."). So 8 PM at a New York venue in January is sent as `01:00Z` the next day. Without a venue, a filled time asks to "Choose a venue first". A time the clocks skip (2:30 AM on the day daylight saving starts) is refused; one that happens twice (when the clocks go back) is the first of the two.
- **Validation** works as on the account pages: the shared request schemas check the form before anything is sent, with the API's messages ("Enter the title", "Choose a venue", "End time must be after the start time"). Rules between fields (the schedule, a venue's total capacity) are checked once every field is valid on its own. Rules only the server knows (the start must be in the future of the [server clock](#the-server-clock), a taken slug, a locked layout) come back from the API and are shown on the field or above the form.
- **Number fields are text** (`inputMode` numeric or decimal), so anything can be typed: "1.5", "ten" or "1e3" in "Rows" is "Rows must be a whole number". Prices are in dollars: "25", "25.5", "$1,250.00" and "0" (free) are accepted; more than two decimals or a negative price is "Enter the price in dollars, e.g. 25 or 25.50", and more than $10,000.00 is refused.
- **Status actions** on the event page: "Publish" (drafts), "Unpublish" and "View in catalogue" (published), "Cancel event" (drafts and published) and "Delete event" (drafts). Cancel and delete open an `alertdialog` ("Cancel this event?", "Delete this event?") with "Keep event" focused; Escape or a click outside dismisses it. After an action a polite live region confirms it ("Published. The event is now in the public catalogue."); a refusal (`event-has-no-batches`, `event-has-sales`, …) appears as an alert with the API's `detail`. Cancelled events offer no actions and can't be edited.
- **The event form** has Title, Slug (optional), Performer, Description, Category, Venue, the three times and the optional Hold duration in seconds and Tickets per order (empty means the API's default). Under "Ticket drop" (a `group`): the "Waiting room" checkbox (always sent, so an edit can turn it off) and the optional "Admission rate per second" (1–1000, default 10) and "Admission time in seconds" (60–3600, default 600). The event page shows them as "Waiting room": "Off" or "On: 10 customers let in per second, for 10 minutes each". The venue select is disabled once the event has a batch (`layout-locked`).
- **Releasing tickets.** Seated sections are checkboxes, released whole (every seat no earlier batch of the event released); general-admission sections take a number of places ("Floor: places to release"). Each section's description says what is left ("Seated · 120 of 200 seats not released yet"); a fully released seated section is disabled. More places than are left is refused before sending. Individual seats (`seatIds`) can only be released through the API.
- **Venue layouts.** Each section is a `group` named "Section N" with "Section name", "Type" (Seated or General admission) and "Rows" and "Seats per row", or "Capacity". "Add seated section" / "Add general admission section" add one (focus moves to its name), "Remove section N" removes it. Once tickets have been released for any event at the venue, the layout is shown as a list and can't change; the other fields still can. "Delete venue" is refused while an event uses the venue.

## API basics

- Base URL locally: `http://localhost:3000` (`pnpm --filter @testtix/api dev`).
- OpenAPI 3 spec: `GET /openapi.json`. Swagger UI: `/docs`. Every operation documents its error response. The same spec is committed as `apps/api/openapi.json` and attached to every CI run as the `openapi-spec` artifact, so you can generate a client or contract checks without running the API.
- JSON in, JSON out. Money is integer cents, currency USD.
- Send `Content-Type: application/json` only with a body: a request that has the header but an empty body (e.g. `POST /admin/events/{id}/publish`) is a 400. `curl --json` sets the header only when it sends data.
- Test-only endpoints live under `/__test/*` and are tagged `test` in the spec; see [Test mode](#test-mode).
- Requests are [rate limited](#rate-limits) per client address; a 429 says how long to wait in `Retry-After`.

## Request IDs

Every response has an `X-Request-Id` header. Send your own (1–128 characters from `A-Z a-z 0-9 . _ : -`) to correlate a test step with server logs; anything else is replaced with a generated UUID. The ID appears as `req.id` in the API's JSON log lines and as `requestId` in error bodies.

```sh
curl -i -H 'X-Request-Id: checkout-test-42' http://localhost:3000/health
```

## Error format

Every error response, whatever the cause, is `application/problem+json` (based on [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "urn:testtix:problem:validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request is invalid. See `errors` for each problem.",
  "instance": "/auth/register",
  "requestId": "checkout-test-42",
  "errors": [{ "path": "email", "code": "invalid_format", "message": "Invalid email address" }]
}
```

| Field       | Meaning                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `type`      | `about:blank` when the HTTP status says it all; a `urn:testtix:problem:*` URI for app-specific problems  |
| `title`     | Short summary of the type (the HTTP status phrase for `about:blank`)                                     |
| `status`    | Same as the HTTP status code                                                                             |
| `detail`    | Explanation of this occurrence. For an unexpected 5xx it is the generic `An unexpected error occurred.`  |
| `instance`  | Request path, without the query string                                                                   |
| `requestId` | Same as the `X-Request-Id` header                                                                        |
| `errors`    | Field errors for validation failures (`path` is dot-separated, e.g. `items.0.quantity`); otherwise empty |

Branch on `type`, never on `title` or `detail`. App-specific types end in an error code in kebab case: `urn:testtix:problem:validation-error` is the code `VALIDATION_ERROR` (the codes live in `packages/shared/src/problems.ts`).

Problem types so far:

| `type`                                             | Status | When                                                                                                                                                                                |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about:blank`                                      | any    | Unknown route (404), malformed JSON (400), not logged in or session expired (401), missing or wrong `X-Test-Key` (401), logged in without the required role (403), 5xx              |
| `urn:testtix:problem:validation-error`             | 400    | Body, query or path parameters fail validation                                                                                                                                      |
| `urn:testtix:problem:invalid-credentials`          | 401    | Login with a wrong email or password                                                                                                                                                |
| `urn:testtix:problem:csrf-token-invalid`           | 403    | A POST, PUT, PATCH or DELETE without a valid `X-CSRF-Token` header (see [CSRF](#csrf-tokens))                                                                                       |
| `urn:testtix:problem:email-already-registered`     | 409    | Registering an email that already has an account (`errors[0].path` is `email`)                                                                                                      |
| `urn:testtix:problem:verification-token-invalid`   | 400    | [Verifying an email](#email-verification) with an unknown or malformed token, or one replaced by a newer email                                                                      |
| `urn:testtix:problem:verification-token-expired`   | 400    | Verifying an email with an unused link past its expiry                                                                                                                              |
| `urn:testtix:problem:email-already-verified`       | 409    | Asking for a new verification email when the address is already verified                                                                                                            |
| `urn:testtix:problem:slug-taken`                   | 409    | Creating or renaming a venue or event with a `slug` that is taken (`errors[0].path` is `slug`)                                                                                      |
| `urn:testtix:problem:venue-in-use`                 | 409    | Deleting a venue that an event uses                                                                                                                                                 |
| `urn:testtix:problem:layout-locked`                | 409    | Replacing a venue's `sections`, or changing an event's `venueId`, after tickets were released                                                                                       |
| `urn:testtix:problem:event-status-conflict`        | 409    | An [event action](#event-lifecycle) its status doesn't allow, e.g. publishing a published event or changing a cancelled one                                                         |
| `urn:testtix:problem:event-has-no-batches`         | 409    | Publishing an event without a ticket batch                                                                                                                                          |
| `urn:testtix:problem:event-already-started`        | 409    | Publishing an event whose `startsAt` has passed                                                                                                                                     |
| `urn:testtix:problem:event-has-sales`              | 409    | Unpublishing or deleting an event with tickets sold or held (or, for deleting, with orders)                                                                                         |
| `urn:testtix:problem:inventory-already-released`   | 409    | A batch lists a seat, or a whole section, that earlier batches already released (`errors` names each)                                                                               |
| `urn:testtix:problem:ga-capacity-exceeded`         | 409    | A batch asks for more GA places than the section has left to release                                                                                                                |
| `urn:testtix:problem:event-not-on-sale`            | 409    | [Holding tickets](#seat-maps-and-holds) before `salesOpenAt` or once the event has started; checking out once it is unpublished, cancelled or started; queueing once it has started |
| `urn:testtix:problem:tickets-unavailable`          | 409    | A hold asks for a seat that is sold, held or not on sale, or for more GA places than are left. Extra members `unavailableSeatIds` and `gaShortfalls` say which                      |
| `urn:testtix:problem:email-not-verified`           | 403    | [Checking out](#checkout-and-orders) before verifying your email address                                                                                                            |
| `urn:testtix:problem:hold-expired`                 | 409    | Checking out a hold that has expired (or has no tickets left)                                                                                                                       |
| `urn:testtix:problem:payment-provider-unavailable` | 503    | Checking out while the payment provider is down, slow or answering errors. The order is kept: retry the same request                                                                |
| `urn:testtix:problem:webhook-signature-invalid`    | 400    | A [payment webhook](#payment-webhooks) without valid signature headers, with a signature that doesn't match, or with a timestamp outside the replay window                          |
| `urn:testtix:problem:queue-required`               | 403    | The seat map or a hold of a [ticket drop](#ticket-drops-and-the-waiting-room) without a valid, unexpired admission token in `X-Admission-Token`                                     |
| `urn:testtix:problem:no-waiting-room`              | 409    | Joining the queue of an event without a waiting room                                                                                                                                |
| `urn:testtix:problem:rate-limited`                 | 429    | Too many requests in a [rate-limit group](#rate-limits). `Retry-After` gives the seconds to wait                                                                                    |

## Rate limits

The API limits how many requests a client sends, so one script can't take the shared demo down. Limits apply to **groups** of routes, each with its own budget, counted per client address in Redis (shared by every API instance):

| Group                | Routes                                                                        | Counted per    | Default (env var)                                   |
| -------------------- | ----------------------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| `default`            | Every route not listed below                                                  | client address | 600 per minute (`RATE_LIMIT_DEFAULT`)               |
| `auth`               | `POST /auth/login`, `/auth/register` and `/auth/verify-email`, together       | client address | 20 per minute (`RATE_LIMIT_AUTH`)                   |
| `testApi`            | The [test API](#test-mode) (`/__test/*`), **instead of** `default`            | client address | 300 per minute (`RATE_LIMIT_TEST_API`)              |
| `verificationResend` | `POST /auth/verify-email/resend`                                              | user           | 3 per 15 minutes (`RATE_LIMIT_VERIFICATION_RESEND`) |
| none                 | `GET /health`, `GET /health/ready`, `GET /metrics`, `POST /webhooks/payments` | –              | never limited                                       |

A request counts towards `default` and its other groups (a login uses up one of `default` and one of `auth`). Every request counts, also those that then fail: limits are checked first, before authentication, CSRF and validation, so 401s and 403s use up the budget too. The per-user resend limit is checked after authentication.

Each counter is a **fixed window** that starts with the client's first request in the group and lasts the window's length (one minute for `600/1m`). Request number limit + 1 within the window gets:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Content-Type: application/problem+json; charset=utf-8

{"type":"urn:testtix:problem:rate-limited","title":"Too many requests","status":429,
 "detail":"Too many requests for the API: the limit is 600 per minute. Try again in 42 s.", …}
```

`Retry-After` is the number of seconds until the window ends; then the client has a full budget again. Windows run on real time, so the [server clock](#the-server-clock) doesn't affect them. [`POST /__test/reset`](#resetting-the-data) clears every counter. The OpenAPI spec documents the 429 and the groups of each operation. `GET /metrics` counts the 429s per group (`testtix_rate_limited_requests_total{group}`).

Things to know when testing:

- **Load runs** send the server's secret in `X-Load-Test-Key` (the server's `LOAD_TEST_KEY`, at least 16 characters) and skip every limit; their requests aren't counted. A wrong key counts as no key. Without `LOAD_TEST_KEY` on the server the header is ignored.
- **UI suites** that log in through the login form many times a minute from one machine run into the `auth` limit. Log in through [`POST /__test/sessions`](#logging-in-through-the-test-api) instead, or turn the limits off locally with `RATE_LIMIT_ENABLED=false`.
- **To test the 429 itself**, set a small limit (e.g. `RATE_LIMIT_DEFAULT=5/10s`) on your local server, or use the resend limit: four `POST /auth/verify-email/resend` calls of one unverified user within 15 minutes give a 429 on the fourth.
- **Behind a proxy** (a load balancer, the web container), set `TRUST_PROXY` (`true`, or the proxies' addresses / CIDR ranges) so the API counts the client address from `X-Forwarded-For`, not the proxy's. Without it, `X-Forwarded-For` is ignored, so it can't be used to get a fresh budget. IPv6 clients are counted by their /64 subnet.
- If Redis is down, requests aren't limited (the API logs a warning once).

<!-- example: http-errors -->

```sh
# The sixth request within 10 s gets a 429 (with RATE_LIMIT_DEFAULT=5/10s on the server)
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' http://localhost:3000/events; done
# A load run's request: never limited
curl -s -H "X-Load-Test-Key: $LOAD_TEST_KEY" http://localhost:3000/events
```

## Accounts and sessions

Accounts log in with email and password. A login session is a cookie; there are no bearer tokens.

| Endpoint                         | Auth           | What it does                                                                                                                                  |
| -------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/csrf`                 | none           | Sets the CSRF cookie and returns its token: `{ "csrfToken": "…" }`                                                                            |
| `POST /auth/register`            | CSRF           | `{ email, password, name }` → 201, creates a customer (email unverified), sends it a [verification email](#email-verification) and logs it in |
| `POST /auth/login`               | CSRF           | `{ email, password }` → 200, logs in                                                                                                          |
| `POST /auth/logout`              | CSRF           | 204. Ends the session and clears the cookie. Also 204 without a session, so it is safe to repeat                                              |
| `GET /auth/me`                   | session        | 200 with the user and session, 401 without a valid session                                                                                    |
| `POST /auth/verify-email`        | CSRF           | `{ token }` → 204, verifies the email address of the token's account (see [Email verification](#email-verification))                          |
| `POST /auth/verify-email/resend` | session + CSRF | 204, emails the logged-in user a new verification link                                                                                        |

Register, login and `me` answer with the user and the session expiry:

```json
{
  "user": {
    "id": "019b76da-a800-7599-864c-1d5467501b78",
    "email": "customer@testtix.test",
    "name": "Casey Customer",
    "role": "CUSTOMER",
    "emailVerified": true,
    "createdAt": "2026-08-23T12:00:00.000Z"
  },
  "session": { "expiresAt": "2026-11-28T18:40:00.000Z" }
}
```

**Validation.** Emails are trimmed and lower-cased, so `  Ada@Example.COM` and `ada@example.com` are the same account (max 254 characters). Passwords are 8–128 characters, used exactly as typed (spaces count). Names are 1–100 characters after trimming. Unknown fields, such as `role`, are a 400: registration always creates a `CUSTOMER`. Login only checks that the password isn't empty.

**Wrong credentials.** A wrong password, an unknown email and an account without a usable password (such as a [scenario buyer](#seed-scenarios)) all get the same 401 `invalid-credentials`, with the same body and roughly the same response time, so the API doesn't reveal which emails are registered. Registration does reveal it (409 `email-already-registered`); that's a deliberate usability trade-off.

### Session cookie

Register and login set `testtix_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, with `Max-Age` = the session TTL, and `Secure` when the server sets `COOKIE_SECURE=true` (the default with `NODE_ENV=production`). The cookie holds a random token; the server stores only its SHA-256 hash in the `sessions` table. Logging in or registering ends the session the request came with, so a browser holds one session at a time. Several browsers (or API clients) can each have their own session for the same account.

- **Expiry is an idle timeout** of `SESSION_TTL_HOURS` (default 168, i.e. 7 days), measured by the [server clock](#the-server-clock). Every authenticated request moves the expiry to now + TTL, at most once a minute, and re-sends the cookie when it does. `session.expiresAt` in `GET /auth/me` shows the current value.
- At `expiresAt` the session is over: the next request answers 401, deletes the session row and clears the cookie. To test it, freeze the clock, log in, then `advanceBy` the TTL (604 800 000 ms by default).
- A request with an unknown, ended or malformed session cookie gets 401 and a `Set-Cookie` that clears it.
- Lifetimes are sent as `Max-Age`, never `Expires`, so a frozen or moved server clock doesn't confuse browsers. Browsers count `Max-Age` in real time, though: after advancing the server clock past the TTL, the browser still sends the cookie and the server rejects it.
- Every 401 carries `WWW-Authenticate: Session realm="testtix"`. A valid session without the required role gets 403 (`about:blank`). The user is loaded on every request, so a role change or a deleted account takes effect immediately.

### CSRF tokens

Every POST, PUT, PATCH and DELETE request (login and register included, the test API excluded) must send an `X-CSRF-Token` header equal to the `testtix_csrf` cookie, or it gets 403 `csrf-token-invalid`. This is the double-submit pattern: another site can make a browser send the cookie but can't read it, so it can't set the header.

1. `GET /auth/csrf` sets `testtix_csrf` (readable by scripts, `SameSite=Lax`, 30 days) and returns the same token. Calling it again returns the existing token and renews the cookie.
2. Send the cookie and the header on every state-changing request. The token doesn't change on login or logout.

On a route that needs a session, a request without one gets 401 before the CSRF check, so the order is: 401 (no session) → 403 (CSRF) → 403 (role) → 400 (validation).

```sh
jar=$(mktemp)
token=$(curl -s -c "$jar" http://localhost:3000/auth/csrf | jq -r .csrfToken)
curl -s -b "$jar" -c "$jar" -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $token" \
  -d '{"email":"customer@testtix.test","password":"TestTix-customer-1"}'
curl -s -b "$jar" http://localhost:3000/auth/me
curl -s -b "$jar" -c "$jar" -X POST http://localhost:3000/auth/logout -H "X-CSRF-Token: $token"
```

For API-based test setup, [`POST /__test/sessions`](#logging-in-through-the-test-api) skips all of this and returns a ready session.

## Public catalogue

Anyone can browse published events; no session is needed. Drafts and cancelled events never appear (`GET /events/{slug}` answers 404 for them).

| Endpoint             | What it does                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `GET /events`        | Upcoming published events, filtered, searched, sorted and [paginated](#pagination)        |
| `GET /events/{slug}` | One published event (past ones too) with its ticket counts and prices per section         |
| `GET /venues`        | Venues with at least one published event, by name, then ID: the choices for `venue` below |

```sh
# Concerts that are on sale, cheapest first
curl -s 'http://localhost:3000/events?category=CONCERT&availability=ON_SALE&sort=price'
# The fixture talk, with its availability per section
curl -s http://localhost:3000/events/testing-in-production-safely
```

### Filters, search and sort

All parameters of `GET /events` are optional and combine with AND. An invalid value is a 400 `validation-error` with the parameter in `errors[].path`.

| Parameter          | Values                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                | Text (at most 100 characters) found anywhere in the title or performer, ignoring case. `%` and `_` match themselves. Blank is ignored |
| `category`         | `CONCERT`, `TALK`, `MEETUP`                                                                                                           |
| `venue`            | A venue slug, e.g. `riverside-hall`. An unknown slug matches nothing                                                                  |
| `from`, `to`       | ISO 8601 date-times with `Z` or an offset. Events starting at or after `from` and before `to`. `to` must be after `from`              |
| `seating`          | `SEATED` (only seats), `GA` (only general admission), `MIXED` (both), judged by the tickets the event has released or scheduled       |
| `availability`     | `SALES_NOT_OPEN`, `ON_SALE`, `SOLD_OUT`, `SALES_ENDED` (see below)                                                                    |
| `sort`             | `date` (default: start time), `price` (lowest ticket price, then start time), `name` (title ignoring case, then start time)           |
| `order`            | `asc` (default) or `desc`. It reverses the sort key only: the start time and ID tiebreakers stay ascending                            |
| `page`, `pageSize` | See [Pagination](#pagination)                                                                                                         |

- **`from` defaults to now** (server clock), so events that have started are left out. Pass an earlier `from` to see them. Move the [clock](#the-server-clock) and the list moves with it.
- **Every sort ends with the event ID**, so events with the same start time (the fixtures `testing-in-production-safely` and `flaky-tests-clinic`), price or title always come in the same order, and paging never skips or repeats one.
- Titles sort by lower-cased code point, the same on every database (accented letters come after `z`).

### Availability

Each event has an `availability`, computed at the server clock:

| Value            | When                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SALES_NOT_OPEN` | `salesOpenAt` is in the future, or no batch is released yet (e.g. `summer-sounds-preview`)                               |
| `ON_SALE`        | Sales are open and at least one released ticket is neither sold nor held                                                 |
| `SOLD_OUT`       | Sales are open, but every released ticket is sold or in an unexpired hold. Expired holds and later batches bring it back |
| `SALES_ENDED`    | The event has started (e.g. `season-opener-showcase`)                                                                    |

Ticket figures count **released tickets only**: a batch with a later `releasesAt` adds nothing until then. List items have `availableTickets` (released, not sold, not held; tickets whose hold expired count) and `priceRange` (`minCents`, `maxCents` over all the event's tickets, scheduled ones included, so it doesn't change as tickets sell). `GET /events/{slug}` adds the description, the venue's address, `maxTicketsPerOrder`, the event's [ticket counts](#ticket-counts) (`tickets`) and `sections`: each section with tickets for the event, in the venue's order, with its own counts, `priceRange` and `nextReleaseAt` (when a scheduled batch releases more tickets there, or `null`). For `midnight-echoes-live` before D+3 15:00, the Balcony shows `total: 0` and `nextReleaseAt` at D+3 15:00.

## Seat maps and holds

Choosing tickets is two steps: read the event's seat map, then **hold** seats and GA places. A hold reserves them for the event's hold duration (default 10 minutes) so nobody else can take them while you check out.

| Endpoint                          | Session | What it does                                                                         |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `GET /events/{eventId}/seats`     | no      | The seat map of a published event: every seat's status, GA places left by price      |
| `POST /events/{eventId}/holds`    | yes     | Holds seats and GA places, all or nothing. 201 with the hold                         |
| `GET /holds/current?eventId={id}` | yes     | Your unexpired hold for the event; without `eventId`, your most recent one. Else 404 |
| `DELETE /holds/{holdId}`          | yes     | Releases your hold at once. 204; 404 for unknown holds and other customers' holds    |

The routes take the event's **ID**, not its slug (`GET /events/{slug}` returns the ID). Holds need a session and, on `POST` and `DELETE`, the [CSRF header](#csrf-tokens); any logged-in user can hold tickets ([checkout](#checkout-and-orders) requires a verified email).

### Seat map

`GET /events/{eventId}/seats` answers 404 unless the event is published, and 403 `queue-required` for a [ticket drop](#ticket-drops-and-the-waiting-room) without an admission token. It has the event's `availability` (holds are only possible while it is `ON_SALE`), `maxTicketsPerOrder`, `holdDurationSec`, and **every section of the venue** in the venue's order:

- **Seated sections** (`type: "SEATED"`) have `rows` (front first, each with its `label` and `index`) of `seats` (by number), each with its `id`, `number`, `priceCents` and `status`, and `available`, the number of `AVAILABLE` seats.
- **GA sections** (`type: "GA"`) have their `capacity`, `available` (the most a hold can ask for there) and `prices`: available places by price, cheapest first. A hold takes the cheapest places, so the running total of _n_ places is the sum of the first _n_ from `prices`.

| Seat `status` | Meaning                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AVAILABLE`   | On sale and free. A seat whose hold has expired is `AVAILABLE` again at once, even before the hold sweeper removes it |
| `HELD`        | In someone's unexpired hold                                                                                           |
| `SOLD`        | Bought                                                                                                                |
| `NOT_ON_SALE` | No released batch includes it: the event doesn't sell it, or its batch releases later. `priceCents` is null or set    |

Statuses don't depend on who asks: your own held seats show as `HELD` too (use `GET /holds/current` to see which are yours).

### Holding tickets

```sh
API=http://localhost:3000
session=$(curl -s -X POST $API/__test/sessions -H 'Content-Type: application/json' -d '{"role":"CUSTOMER"}')
auth=(-H "Cookie: $(echo "$session" | jq -r .cookie)" -H "X-CSRF-Token: $(echo "$session" | jq -r .csrfToken)")
# A concert with seats and a standing area (a seed scenario), and its seat map
event=$(curl -s -X POST $API/__test/seed/basic-catalogue | jq -r .events.concert.id)
map=$(curl -s "$API/events/$event/seats")
seat=$(echo "$map" | jq -r '.sections[] | select(.type == "SEATED") | .rows[0].seats[0].id')
standing=$(echo "$map" | jq -r '.sections[] | select(.type == "GA") | .id')
# Row A seat 1 and two standing places
curl -s -X POST "$API/events/$event/holds" "${auth[@]}" -H 'Content-Type: application/json' \
  -d "{\"seats\":[\"$seat\"],\"ga\":[{\"sectionId\":\"$standing\",\"quantity\":2}]}"
```

The body has `seats` (seat IDs from the seat map) and `ga` (`sectionId` and `quantity` per GA section); either may be left out, but not both. The answer is the hold: its `id`, `eventId`, `createdAt`, `expiresAt` (now + the event's hold duration, [server clock](#the-server-clock)), `totalCents` and `items`, one per ticket, in the venue's section order, then row and seat (GA places by price), each with its `inventoryUnitId`, `section`, `seat` (null for GA) and `priceCents`.

Rules, checked in this order:

1. **400 `validation-error`** for an invalid body: no tickets, a seat or section listed twice, a quantity below 1, more than 20 tickets, unknown fields.
2. **404** unless the event is published.
3. **403 `queue-required`** for a [ticket drop](#ticket-drops-and-the-waiting-room) without your unexpired admission token in `X-Admission-Token`.
4. **409 `event-not-on-sale`** before `salesOpenAt` or once the event has started.
5. **400 `validation-error`** for more tickets (seats plus GA places) than the event's `maxTicketsPerOrder` (6 by default; `errors[0]` has `path: ""`, `code: "too_big"`), and for seats or sections that aren't at the event's venue (`seats.<i>` / `ga.<i>.sectionId`, `code: "not_found"`; a seated section in `ga` counts as not found).
6. **409 `tickets-unavailable`** when any requested seat is sold, in an unexpired hold or not on sale, or a GA section has fewer claimable places than asked for. **Nothing is held**: a mixed request whose GA part fails doesn't hold its seats either. The body says what failed:

```json
{
  "type": "urn:testtix:problem:tickets-unavailable",
  "title": "Tickets unavailable",
  "status": 409,
  "detail": "A seat is no longer available. A general-admission section has only 2 places left. Nothing was held.",
  "unavailableSeatIds": ["019ac6b2-…"],
  "gaShortfalls": [{ "sectionId": "019ac6b2-…", "requested": 3, "available": 2 }],
  "…": "instance, requestId, errors as usual"
}
```

**One hold per customer and event.** A successful hold replaces your previous hold for the event (its tickets are released in the same step, so you can keep some seats and swap others). A failed request leaves the previous hold as it was. Holds for different events are independent.

**Concurrency.** Holds are atomic: when many customers ask for the same seat at the same moment, exactly one gets 201 and the others 409; when 20 customers each ask for one of the last 3 GA places, exactly 3 succeed. No seat or place is ever in two unexpired holds.

**Expiry** is lazy: once `expiresAt` passes, the hold's tickets count as available everywhere (seat map, catalogue figures, new holds), and `GET /holds/current` no longer returns it. Nothing needs to run first. Test it without waiting by moving the clock:

```sh
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' -d '{"advanceBy":600000}'
```

`DELETE /holds/{holdId}` works on an expired hold too (204); it never takes back tickets someone else has held since.

**Cleanup.** A background job, the hold sweeper, deletes expired holds and frees the tickets they still have, every `HOLD_SWEEPER_INTERVAL_MS` (default 60 seconds) by the server clock: after `advanceBy`, the next sweep picks them up. It is cleanup only, so no response above changes because of it, with two exceptions: once a hold has been swept, `DELETE /holds/{holdId}` and `POST /orders` with its ID answer 404 instead of 204 and 409 `hold-expired`. `HOLD_SWEEPER_ENABLED=false` turns it off (expired holds then stay in the database, with their tickets still available). The job runs inside the API by default; see [background jobs](../README.md#background-jobs) to run it as a separate worker.

## Ticket drops and the waiting room

An event with `waitingRoomEnabled` (set through the [admin API](#events)) is a **ticket drop**: customers queue in a waiting room and are let in a few at a time. Only customers let in can see its seat map and hold tickets; once they have a hold, checkout works as usual. The [drop scenarios](#drop-scenarios) give you a ready-made drop that opens in 5 minutes, now, or (sized for load tests) when you say.

| Endpoint                       | Session | What it does                                                                                |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------- |
| `POST /events/{eventId}/queue` | yes     | Joins the queue (201), or returns your current entry (200)                                  |
| `GET /queue/{token}`           | yes     | Your entry: status, position, estimated wait, `retryAfterMs`, and the admission once let in |

`POST` needs the [CSRF header](#csrf-tokens). Both answer the same body:

```json
{
  "token": "pY3vS0wV2m9n1x8C4k7Q6d5b",
  "eventId": "019ac6b2-…",
  "status": "WAITING",
  "joinedAt": "2026-12-01T09:59:12.000Z",
  "salesOpenAt": "2026-12-01T10:00:00.000Z",
  "position": 37,
  "queueLength": 412,
  "estimatedWaitMs": 3000,
  "retryAfterMs": 2000,
  "admission": null
}
```

| `status`   | Meaning                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PRE_SALE` | Joined before `salesOpenAt`. `position` and `estimatedWaitMs` are null: the order is only fixed at the opening (see below) |
| `WAITING`  | Sales are open. `position` 1 is next in; `estimatedWaitMs` comes from the position and the event's admission rate          |
| `ADMITTED` | Let in. `admission` has the `token` and its `expiresAt`                                                                    |
| `EXPIRED`  | The admission ran out. Join again to queue at the back                                                                     |

**Rules**

- **Joining** needs a published event with a waiting room (else 404, or 409 `no-waiting-room`) that hasn't started (409 `event-not-on-sale`). You can join any time before that, long before sales open too.
- **One entry per customer and event.** Joining again while you wait or are admitted returns the same entry with 200, even for concurrent requests. Once your admission has expired, joining again gives a **new** entry at the back of the queue with new tokens (201); the old queue token then answers 404.
- **Order.** Everyone who joins **before `salesOpenAt`** is let in in a **random order** once sales open (so arriving early doesn't help, but it puts you ahead of everyone who comes later). After the opening, customers are let in in **join order**, behind everyone who joined before it; that holds with a frozen clock too, where every join has the same time.
- **Rate.** A background job lets in at most `admissionRatePerSec` customers per second of [server time](#the-server-clock): the first batch at the opening, the next one a second later, and so on. Customers who join an empty queue after the opening go in with the next run. An idle queue saves nothing up: a minute without anyone waiting doesn't let 60 batches in at once later.
- **Admission tokens** last `admissionTokenTtlSec` (default 600 s) from the moment you are let in. Send yours in the **`X-Admission-Token`** header to `GET /events/{eventId}/seats` and `POST /events/{eventId}/holds`. Without one, with an expired one ("Your admission has expired. Join the queue again."), one for another event or, on holds, another customer's token, both answer **403 `queue-required`**. The seat map is public, so it only checks the token belongs to the event; holds also check it is yours. Holds you already have and checkout don't need the token, so an admission running out while you pay changes nothing.
- **Turning the waiting room off** lets everyone still waiting in at the job's next run, and the seat map and holds stop asking for tokens. Turning it on mid-sale makes the seat map and new holds require a token from then on; existing holds are kept.
- `GET /events/{slug}` has `waitingRoomEnabled`, so clients know to queue first. The web app's side is the [waiting room page](#waiting-room-page).

**Polling.** Wait `retryAfterMs` between polls of `GET /queue/{token}` (at most `QUEUE_POLL_INTERVAL_MS`, default 2000; before the opening, no later than the opening; at least 250 ms), and stop when it is null (`ADMITTED` or `EXPIRED`). `GET /queue/{token}` answers 404 for unknown tokens and other customers' tokens.

**Time.** Everything follows the server clock, so a drop is testable without waiting. With a **frozen** clock nobody new is let in; every `advanceBy` lets in the batches that fell due (advance by 1 s for one batch, by 10 s for ten at once). The job itself runs every `QUEUE_ADMISSION_INTERVAL_MS` (default 1000 ms) of real time, so allow up to about a second after moving the clock (poll, don't sleep). It runs in the worker (inside the API by default; see [background jobs](../README.md#background-jobs)); without a worker, nobody is let in.

```sh
API=http://localhost:3000
session=$(curl -s -X POST $API/__test/sessions -H 'Content-Type: application/json' -d '{"role":"CUSTOMER"}')
auth=(-H "Cookie: $(echo "$session" | jq -r .cookie)" -H "X-CSRF-Token: $(echo "$session" | jq -r .csrfToken)")
# Freeze the clock, then add a drop whose sales open 5 minutes later, and queue
curl -s -X POST $API/__test/clock -H 'Content-Type: application/json' \
  -d "{\"freezeAt\":\"$(curl -s $API/__test/clock | jq -r .now)\"}"
event=$(curl -s -X POST $API/__test/seed/drop-in-5-min | jq -r .event.id)
token=$(curl -s -X POST "$API/events/$event/queue" "${auth[@]}" | jq -r .token)   # → status PRE_SALE
# Open sales. The first batch goes in with the job's next run: poll until let in
curl -s -X POST $API/__test/clock -H 'Content-Type: application/json' -d '{"advanceBy":300000}'
until entry=$(curl -s "$API/queue/$token" "${auth[@]}") && [ "$(echo "$entry" | jq -r .status)" = ADMITTED ]; do
  sleep "$(echo "$entry" | jq '.retryAfterMs / 1000')"
done
# The seat map with the admission token, then the clock back to real time
curl -s "$API/events/$event/seats" -H "X-Admission-Token: $(echo "$entry" | jq -r .admission.token)" | jq .availability
curl -s -X POST $API/__test/clock -H 'Content-Type: application/json' -d '{"reset":true}'
```

**Metrics.** `GET /metrics` has, per event that has had a queue (label `event_id`): `testtix_waiting_room_queue_length` (customers waiting), `testtix_waiting_room_admitted_total` (customers let in; `rate()` of it is the actual admission rate) and `testtix_waiting_room_admission_rate` (the configured rate the job last applied; 0 while the waiting room is off). Every API instance reports the same numbers, read from Redis.

**Storage.** Waiting rooms live in Redis (`testtix:queue:*`), not Postgres. [`POST /__test/reset`](#resetting-the-data) empties them. While Redis is down, joining, polling and the token check answer 503 (500 in test mode, where the server clock itself lives in Redis).

## Payments

Checkout pays through a **fake hosted payment provider** (`apps/fake-payments`, `http://localhost:4000`, started by `pnpm infra:up`). It behaves like a real one: the shop creates a payment session, sends the customer to the provider's payment page, and later learns the result from a signed **webhook**. What happens is decided by the [test card](#test-cards) the customer types. The API creates the sessions when you [check out](#checkout-and-orders); to test the provider itself, call it directly.

| Endpoint             | Auth    | What it does                                                                     |
| -------------------- | ------- | -------------------------------------------------------------------------------- |
| `POST /sessions`     | API key | Creates a payment session. 201 with the session, whose `url` is the payment page |
| `GET /sessions/{id}` | API key | The session: its `status`, `failureCode` and every webhook delivery attempt      |
| `GET /pay/{id}`      | none    | The payment page (HTML)                                                          |
| `POST /pay/{id}`     | none    | The page's form submission                                                       |
| `GET /health`        | none    | `{"status":"ok"}`                                                                |

The API key is `Authorization: Bearer <PAYMENTS_API_KEY>` (default `sk_test_testtix_local_only`); without it the answer is 401 with `WWW-Authenticate: Bearer`. JSON errors use the [same problem details format](#error-format) as the API.

```sh
curl -s http://localhost:4000/sessions \
  -H 'Authorization: Bearer sk_test_testtix_local_only' -H 'Content-Type: application/json' \
  -d '{"amountCents":9000,"currency":"USD","description":"2 tickets for Jazz Night",
       "returnUrl":"http://localhost:5173/orders/123","webhookUrl":"http://host.docker.internal:3000/webhooks/payments",
       "metadata":{"orderId":"123"}}'
```

The body: `amountCents` (1 to 100,000,000), `currency` (`USD` only), `description` (shown on the page), `returnUrl` and `webhookUrl` (http or https), and optional `metadata` (up to 20 string values, returned in the session and every webhook). The session adds `id` (`ps_…`), `status`, `url`, `failureCode`, `createdAt`, `expiresAt` (30 minutes later, `SESSION_TTL_MINUTES`), `completedAt` and `webhookDeliveries`.

| Session `status` | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `OPEN`           | Waiting on the payment page                                                     |
| `SUCCEEDED`      | Paid                                                                            |
| `FAILED`         | The card was declined; `failureCode` is `CARD_DECLINED` or `INSUFFICIENT_FUNDS` |
| `EXPIRED`        | Nobody paid before `expiresAt`. No webhook is sent                              |

Sessions live **in memory**: restarting the container forgets them, along with webhooks waiting to be retried. A session is forgotten a day after it expires.

### Payment page

`GET /pay/{id}` shows the amount, the description and a card form (card number, expiry `MM/YY`, security code, name on card), plus a "Cancel and return to the shop" link and a **Test cards** disclosure that lists the cards below. It needs no JavaScript.

- A submission with problems answers **400** and shows the form again: an error summary (`role="alert"`, focused on load, each problem a link to its field) and the message next to each field (`aria-invalid="true"`). Everything typed is kept except the security code. The title starts with `Error:`. Messages: `Enter the card number`, `Enter a card number of 12 to 19 digits`, `Enter a valid card number` (fails the Luhn check), `This is not a test card. Use one of the test cards listed on this page`, `Enter the expiry date`, `Enter the expiry date as MM/YY, for example 08/29`, `The card has expired` (before the current month, UTC), `Enter the security code`, `Enter the 3 or 4 digit security code`, `Enter the name on the card`.
- A valid test card completes the payment **once** and answers **303** to `returnUrl` with `session_id=<id>` added to its query, for success and failure alike: the shop learns the result from the webhook, not from the redirect.
- After that, the page shows "Payment complete" or "Payment failed" (200), and submitting again answers **409** with the same page. An expired session shows "This payment link has expired" with **410**, also on submit. An unknown session is a **404** "Payment not found" page.

### Test cards

Any expiry date in the future, any 3- or 4-digit security code and any name work.

| Card number           | Result                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `4242 4242 4242 4242` | Succeeds; webhook sent right away                                      |
| `4000 0000 0000 0002` | Fails with `CARD_DECLINED`                                             |
| `4000 0000 0000 9995` | Fails with `INSUFFICIENT_FUNDS`                                        |
| `4000 0000 0000 0077` | Succeeds, but **no webhook** is ever sent                              |
| `4000 0000 0000 0457` | Succeeds; webhook sent after `DELAYED_WEBHOOK_MS` (default 10 seconds) |
| `4000 0000 0000 0887` | Succeeds; the same event (same `id`) is **delivered twice** at once    |

Other card numbers are rejected as "not a test card", so a typo never charges anything by accident.

### Webhooks

Each payment result is one event, POSTed as JSON to the session's `webhookUrl`:

```json
{
  "id": "evt_…",
  "type": "payment.succeeded",
  "createdAt": "2026-11-22T20:39:02.123Z",
  "data": {
    "sessionId": "ps_…",
    "status": "SUCCEEDED",
    "amountCents": 9000,
    "currency": "USD",
    "failureCode": null,
    "metadata": { "orderId": "123" }
  }
}
```

`type` is `payment.succeeded` or `payment.failed` (with `status: "FAILED"` and a `failureCode`). Every delivery of an event has the same body and `id`, so receivers deduplicate on `id`.

**Signature.** Each request has `X-Payments-Timestamp` (Unix seconds) and `X-Payments-Signature: v1=<hex>`, the HMAC-SHA256 of `<timestamp>.<raw body>` keyed with `PAYMENTS_WEBHOOK_SECRET` (default `whsec_testtix_local_only`). Verify against the raw bytes, before parsing the JSON. To check a signature by hand, or to forge a webhook in a test:

```sh
printf '%s' '1795000000.{"id":"evt_1"}' | openssl dgst -sha256 -hmac 'whsec_testtix_local_only'
# → 4e45a225d44ef0629890f9f07196d76d0d3199c5e0f4ee719ee5cf966c250460, sent as v1=4e45a2…
```

`X-Payments-Attempt` (1, 2, …) says which attempt this is; it is not signed.

**Retries.** Any 2xx answer counts as delivered. Any other status, a redirect (not followed), a connection error or no answer within `WEBHOOK_TIMEOUT_MS` (5 s) is retried: after `WEBHOOK_RETRY_BASE_MS` (1 s), then 2 s, 4 s, 8 s and so on (capped at 5 minutes, no jitter), up to `WEBHOOK_MAX_ATTEMPTS` deliveries in all (6). Each attempt is signed again with a fresh timestamp. `GET /sessions/{id}` lists every attempt in `webhookDeliveries`: `eventId`, `attempt`, `sentAt`, `statusCode` (null without an answer) and `error` (e.g. `ECONNREFUSED`, `No response within 5000 ms`).

The container reaches an API on your machine at `host.docker.internal` (e.g. `http://host.docker.internal:3000/webhooks/payments`). The timing variables are set through the root `.env` with a `FAKE_PAYMENTS_` prefix (`FAKE_PAYMENTS_DELAYED_WEBHOOK_MS=2000`, see `.env.example`), then `pnpm infra:up` recreates the container.

## Checkout and orders

Checking out turns your hold into an **order** and a payment page. The order goes `PENDING_PAYMENT` → (payment, reported by [webhook](#payment-webhooks)) → `PROCESSING` → `CONFIRMED` or `FAILED`; an unpaid order becomes `EXPIRED` with its hold.

| Endpoint                | Session | What it does                                                                                  |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `POST /orders`          | yes     | Checks out a hold: `{"holdId":"…"}`. 201 with the new order, 200 with the hold's existing one |
| `GET /orders/{orderId}` | yes     | One of your orders, with its items. 404 for unknown orders and other customers' orders        |
| `GET /orders`           | yes     | Your orders, newest first, [paginated](#pagination) (`page`, `pageSize`)                      |

`POST` needs the [CSRF header](#csrf-tokens). The [`hold-about-to-expire`](#seed-scenarios) scenario gives you a logged-in customer with a hold to check out:

<!-- example: group=checkout -->

```sh
API=http://localhost:3000
# A customer holding two seats for 10 minutes
seed=$(curl -s -X POST $API/__test/seed/hold-about-to-expire -H 'Content-Type: application/json' -d '{"expiresInSec":600}')
auth=(-H "Cookie: $(echo "$seed" | jq -r .holder.cookie)" -H "X-CSRF-Token: $(echo "$seed" | jq -r .holder.csrfToken)")
order=$(curl -s -X POST $API/orders "${auth[@]}" -H 'Content-Type: application/json' \
  -d "{\"holdId\":\"$(echo "$seed" | jq -r .hold.id)\"}")
echo "$order" | jq '{id, status, totalCents, paymentUrl}'   # → PENDING_PAYMENT, $90.00
```

The order has its `id`, `status`, `event` (`id`, `slug`, `title`, `startsAt`, `venue.name`, `venue.timezone`), `totalCents`, `ticketCount`, `items` (the hold's items: `inventoryUnitId`, `section`, `seat`, `priceCents`, and `ticket`: `{ id, code }` once the order is confirmed, else `null`; see [tickets](#tickets)), `expiresAt`, `createdAt`, `updatedAt`, `paymentUrl`, `retryAfterMs` and `refundDue` (see [late payments](#late-and-out-of-order-payments)). Send the customer to `paymentUrl`, the [payment page](#payment-page); afterwards the provider returns them to `<WEB_BASE_URL>/orders/<order id>?session_id=…`. List items (`GET /orders`) have the same fields without `items`, `paymentUrl`, `updatedAt`, `retryAfterMs` and `refundDue`.

Rules of `POST /orders`, checked in this order:

1. **400 `validation-error`** unless the body is exactly `{"holdId":"<uuid>"}`.
2. **403 `email-not-verified`** until your email is [verified](#email-verification) (test sessions are verified unless created with `"emailVerified":false`).
3. **404** for unknown holds, other customers' holds, and holds already released, replaced or [swept](#holding-tickets), or used up by a paid or free order (`PROCESSING` onwards).
4. **409 `hold-expired`** once the hold's `expiresAt` has passed.
5. If the hold already has an unpaid order, **200** with that order: a hold has at most one order, so a double click or a retry is harmless (two requests at the same moment get one 201 and one 200 with the same order).
6. **409 `event-not-on-sale`** when the event was unpublished or cancelled, or has started, since the hold was made.
7. **201** with the new order. Then the API asks the provider for a payment session. If that fails (unreachable, an error status, or no answer within `PAYMENTS_TIMEOUT_MS`, 5 s), the answer is **503 `payment-provider-unavailable`**, but the order exists, `PENDING_PAYMENT` with `paymentUrl: null`, and the hold is unchanged: send the same request again (200, now with `paymentUrl`). To try it, stop the provider (`docker compose --project-directory . -f docker/compose.yml stop fake-payments`; `pnpm infra:up` starts it again).

**Free orders** (every ticket priced $0) get no payment page, since the provider can't take a payment of 0: the 201 answer is already `PROCESSING` (`paymentUrl: null`), and the [processing job](#processing) confirms it.

**The order owns the hold while it is unpaid.** Its tickets stay `HELD` in your hold (the seat map shows them as `HELD`), and the order's `expiresAt` is the hold's. The unpaid order expires when the hold ends, whichever way:

- **The hold runs out:** at `expiresAt` (server clock) the order is `EXPIRED` in every response at once, like holds ([lazy expiry](#holding-tickets)); the hold sweeper later stores that in the database and frees the tickets. Move the clock to test it.
- **You release the hold** (`DELETE /holds/{holdId}`) or **replace it** with a new hold for the same event: the unpaid order becomes `EXPIRED` in the same step. The new hold can be checked out as a new order.

Paying an expired order's payment page anyway is possible (the provider doesn't know about the hold): the payment is recorded and flagged for refund, never selling the tickets ([late payments](#late-and-out-of-order-payments)).

**Polling.** `retryAfterMs` says how long to wait before asking for the order again: `ORDER_POLL_INTERVAL_MS` (2 s) while it can still change, never past `expiresAt` while it is unpaid (so a poll lands right at expiry), and `null` once the status is final (`CONFIRMED`, `FAILED`, `EXPIRED`). Stop polling then.

| Order `status`    | Meaning                                                                    | `paymentUrl`  | `retryAfterMs` |
| ----------------- | -------------------------------------------------------------------------- | ------------- | -------------- |
| `PENDING_PAYMENT` | Waiting for payment until `expiresAt`                                      | set (or null) | ≤ 2000         |
| `PROCESSING`      | The provider reported a result; the job finishes it soon. Tickets are sold | null          | 2000           |
| `CONFIRMED`       | Paid (or free); the tickets stay sold and are issued, the email goes out   | null          | null           |
| `FAILED`          | The payment was declined; the tickets are available again                  | null          | null           |
| `EXPIRED`         | Not paid while the hold lasted: it ran out, or you released or replaced it | null          | null           |

### Payment webhooks

The provider reports each payment to `POST /webhooks/payments` ([webhook format](#webhooks)). No session or CSRF token: the signature is the authentication. The endpoint checks, in this order:

1. **400 `webhook-signature-invalid`** when `X-Payments-Signature` or `X-Payments-Timestamp` is missing or malformed, the signature doesn't match the raw body under `PAYMENTS_WEBHOOK_SECRET` (default `whsec_testtix_local_only`, the same variable the provider reads), or the timestamp is more than `PAYMENTS_WEBHOOK_TOLERANCE_SEC` (300 s) from the **real** time. The replay window ignores the [test clock](#the-server-clock), since the provider stamps its own real clock: moving the server clock never makes webhooks stale.
2. **400 `validation-error`** when a correctly signed body isn't a webhook event.
3. **200** otherwise, with `{"eventId":"evt_…","outcome":"APPLIED","duplicate":false}`. Each event `id` is recorded once (`payment_events`); later deliveries of the same event, even two at the same moment, answer 200 with `duplicate: true` and the recorded `outcome`, and change nothing.

`outcome` says what the event did:

| `outcome`    | When                                                                                                                                                                                         | Effect                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `APPLIED`    | The first result (success or failure) for a `PENDING_PAYMENT` order that hasn't expired (server clock), from the order's own payment session and for its total                               | The order becomes `PROCESSING`; the job confirms or fails it                  |
| `REFUND_DUE` | A success no order can use: the order had expired (or its hold was released or replaced), already has a result, isn't known (`metadata.orderId`), or the session or amount isn't the order's | Recorded and due a refund; nothing is sold. The order shows `refundDue: true` |
| `IGNORED`    | A failure that changes nothing (the order already has a result, or is gone), or the same success reported again under a new event `id`                                                       | Recorded only                                                                 |

**A `PROCESSING` order's tickets are safe.** When the payment result arrives, the tickets leave the hold and are `SOLD` (the seat map shows them as sold), and the hold is used up: releasing it answers 404, a new hold can't take those seats, and the hold sweeper has nothing to free. Only the processing job decides them.

#### Processing

A background job finishes every `PROCESSING` order `JOB_PROCESSING_DELAY_MS` (default 1000 ms) after the webhook, so clients see "processing" for a while ("data appears eventually"); raise the delay to watch it longer. A successful payment (or a free order) becomes **`CONFIRMED`** and its tickets stay sold; a failed one becomes **`FAILED`** and its tickets are available again at once. Running the job twice changes nothing. If the job could not be queued (Redis down) or failed for good, a recovery job that runs every minute queues it again once the order has been `PROCESSING` for longer than the delay plus 60 seconds (server clock). The job runs in the worker (`WORKER_IN_PROCESS=true` by default, or `start:worker`); without a worker, orders stay `PROCESSING`.

The delay is real time, not the server clock: freezing the clock does not hold orders in `PROCESSING`.

#### Late and out-of-order payments

- **Paid after the hold expired:** the provider took the money, but the order is `EXPIRED` and its tickets may be someone else's. The payment is `REFUND_DUE`, the order stays (or becomes) `EXPIRED` with `refundDue: true`, and no ticket is sold. This works whether or not the sweeper has run yet. To try it: check out, move the [clock](#the-server-clock) past `expiresAt`, then pay.
- **A failure after the success** (another event `id`): `IGNORED`; the order is confirmed.
- **A success after the failure:** `REFUND_DUE`; the order stays `FAILED`, its tickets released.
- **Duplicates** (the `4000 0000 0000 0887` card, or provider retries): one transition; the rest are `duplicate: true`.
- **No webhook** (the `4000 0000 0000 0077` card): the order stays `PENDING_PAYMENT` and expires with its hold, like an unpaid order.

To send a webhook by hand, sign the exact bytes you send (see [Signature](#webhooks)). Continuing the [checkout example](#checkout-and-orders), this reports its payment as the provider would (the payment session ID is the last part of `paymentUrl`), then polls the order until it is final:

<!-- example: group=checkout -->

```sh
orderId=$(echo "$order" | jq -r .id)
body=$(echo "$order" | jq -c '{id: "evt_manual_\(.id)", type: "payment.succeeded", createdAt: (now | todate),
  data: {sessionId: (.paymentUrl | split("/") | last), status: "SUCCEEDED", amountCents: .totalCents,
         currency: "USD", failureCode: null, metadata: {orderId: .id}}}')
ts=$(date +%s)
sig=$(printf '%s' "$ts.$body" | openssl dgst -sha256 -hmac 'whsec_testtix_local_only' | awk '{print $NF}')
curl -s -X POST http://localhost:3000/webhooks/payments -H 'Content-Type: application/json' \
  -H "X-Payments-Timestamp: $ts" -H "X-Payments-Signature: v1=$sig" --data-raw "$body"
# → {"eventId":"evt_manual_…","outcome":"APPLIED","duplicate":false}
while order=$(curl -s "$API/orders/$orderId" "${auth[@]}") && [ "$(echo "$order" | jq .retryAfterMs)" != null ]; do
  sleep "$(echo "$order" | jq '.retryAfterMs / 1000')"
done
echo "$order" | jq -r .status   # → CONFIRMED
```

### Tickets

When the [processing job](#processing) confirms an order (paid or free), it issues **one ticket per item** in the same step: a `CONFIRMED` order always has all its tickets, and a `FAILED` or `EXPIRED` one has none. Each ticket has a **code**, 22 random base64url characters (128 bits, unguessable and unique), which its QR code encodes and nothing else. Running the job again issues nothing new.

`GET /orders/{orderId}` shows each item's `ticket` (`id` and `code`), and right after confirmation the [e-ticket email](#e-ticket-email) goes out.

| Endpoint                      | Session | What it does                                                                                      |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `GET /tickets/{ticketId}/pdf` | yes     | One of your tickets as a one-page PDF (`application/pdf`, download). 404 for anyone else's ticket |

```sh
# A customer with a confirmed order (a seed scenario); download its first ticket
seed=$(curl -s -X POST http://localhost:3000/__test/seed/confirmed-order)
ticket=$(echo "$seed" | jq -r '.order.tickets[0].id')
curl -s -o ticket.pdf "http://localhost:3000/tickets/$ticket/pdf" -H "Cookie: $(echo "$seed" | jq -r .customer.cookie)"
```

The answer has `Content-Disposition: attachment; filename="testtix-ticket-<ticket id>.pdf"` and `Cache-Control: private, no-store`. A malformed ID is a 400 `validation-error`, an unknown ticket or another customer's a 404 (so nobody learns which IDs exist), and no session a 401. The [`confirmed-order`](#seed-scenarios) scenario, used above, gives you a logged-in customer with three tickets to download.

**A ticket page** (A4) shows "TestTix e-ticket", "Ticket n of m", the event title and performer, its start in the venue's time zone (e.g. "Wednesday, March 10, 2027 at 8:00 PM EST"), the venue with its address, the place (**"Seats · Row A · Seat 1"**, or **"General admission – Floor"** for a GA place), the price, the QR with the code printed under it, and the order ID. The PDF uses the standard Helvetica font, so text outside Latin-1 (plus `€ – — “ ” …`) is simplified on the page: accents it can't show are dropped ("Ő" → "O", "Đ" → "D") and other characters print as "?" (emoji, CJK). The email shows the original text.

## Admin API

Admins manage venues, events and ticket batches under `/admin/*`. This is also the **API-based data setup** path: a test creates exactly the venue, event and inventory it needs, with its own IDs, instead of sharing the [seed data](#seed-data). Every route needs a session with the `ADMIN` role (anonymous → 401, customer → 403) and, on writes, the [CSRF header](#csrf-tokens). The quickest admin session is [`POST /__test/sessions`](#logging-in-through-the-test-api) with `{"role":"ADMIN"}`; outside test mode, log in as an admin.

| Endpoint                                 | What it does                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /admin/venues`                      | Venues by name, then ID, [paginated](#pagination)                                        |
| `POST /admin/venues`                     | 201. Creates a venue and generates its layout                                            |
| `GET /admin/venues/{venueId}`            | The venue with every seat                                                                |
| `PATCH /admin/venues/{venueId}`          | Changes the fields sent; `sections` replaces the layout                                  |
| `DELETE /admin/venues/{venueId}`         | 204. Only while no event uses it (409 `venue-in-use`)                                    |
| `GET /admin/events`                      | Events of every status (drafts too) by start time, then ID. Filters: `status`, `venueId` |
| `POST /admin/events`                     | 201. Creates a `DRAFT` event                                                             |
| `GET /admin/events/{eventId}`            | The event with its batches and ticket counts                                             |
| `PATCH /admin/events/{eventId}`          | Changes the fields sent                                                                  |
| `DELETE /admin/events/{eventId}`         | 204. Drafts only, without sales or orders                                                |
| `POST /admin/events/{eventId}/publish`   | `DRAFT` → `PUBLISHED`                                                                    |
| `POST /admin/events/{eventId}/unpublish` | `PUBLISHED` → `DRAFT`                                                                    |
| `POST /admin/events/{eventId}/cancel`    | `DRAFT` or `PUBLISHED` → `CANCELLED`                                                     |
| `POST /admin/events/{eventId}/batches`   | 201. Releases a ticket batch                                                             |

IDs in paths are UUIDs: a malformed one is a 400 `validation-error`, an unknown one a 404. Unknown body fields are a 400 too.

### Data setup walkthrough

```sh
session=$(curl -s -X POST http://localhost:3000/__test/sessions \
  -H 'Content-Type: application/json' -d '{"role":"ADMIN"}')
cookie=$(echo "$session" | jq -r .cookie); csrf=$(echo "$session" | jq -r .csrfToken)
# --json sends a JSON body with its Content-Type; body-less calls (publish) must not send one
admin() { curl -s -H "Cookie: $cookie" -H "X-CSRF-Token: $csrf" "$@"; }

# 1. A venue with a seated section (rows A–C × 8) and a standing area
venue=$(admin http://localhost:3000/admin/venues --json '{
  "name": "My Test Hall", "address": "1 Test St", "city": "Port Ellis", "timezone": "America/New_York",
  "sections": [
    { "type": "SEATED", "name": "Stalls", "rows": 3, "seatsPerRow": 8 },
    { "type": "GA", "name": "Standing", "capacity": 100 }
  ]}')
venueId=$(echo "$venue" | jq -r .id)
stalls=$(echo "$venue" | jq -r '.sections[0].id'); standing=$(echo "$venue" | jq -r '.sections[1].id')

# 2. A draft event (times must be in the future of the server clock)
event=$(admin http://localhost:3000/admin/events --json "{
  \"title\": \"My Test Gig\", \"performer\": \"The Testers\", \"description\": \"Made by a test.\",
  \"category\": \"CONCERT\", \"venueId\": \"$venueId\",
  \"startsAt\": \"2027-06-01T20:00:00Z\", \"endsAt\": \"2027-06-01T23:00:00Z\",
  \"salesOpenAt\": \"2026-12-01T10:00:00Z\"}")
eventId=$(echo "$event" | jq -r .id)

# 3. Put the stalls on sale at $45.00 and 50 standing places at $25.00, then publish
admin "http://localhost:3000/admin/events/$eventId/batches" \
  --json "{\"name\": \"Stalls\", \"priceCents\": 4500, \"seatedSectionIds\": [\"$stalls\"]}"
admin "http://localhost:3000/admin/events/$eventId/batches" \
  --json "{\"name\": \"Standing\", \"priceCents\": 2500, \"gaSections\": [{\"sectionId\": \"$standing\", \"quantity\": 50}]}"
admin -X POST "http://localhost:3000/admin/events/$eventId/publish"
```

The event is now in the public catalogue. Data created this way stays until the next [reset](#resetting-the-data).

### Venues and layouts

`POST /admin/venues` takes `name`, `address`, `city`, `timezone` (IANA, e.g. `Europe/Paris`; stored in its canonical spelling, so `europe/paris` becomes `Europe/Paris`), an optional `slug` and `sections`, in display order:

- `{ "type": "SEATED", "name": "Stalls", "rows": 10, "seatsPerRow": 20 }` generates a grid of seats: rows lettered from the front (`A`…`Z`, then `AA`, `AB`, …), seats numbered from 1 in each row.
- `{ "type": "GA", "name": "Floor", "capacity": 250 }` is a general-admission area without seats.

Limits: 1–20 sections, 1–50 rows and 1–100 seats per row per seated section, GA capacity 1–5000, and at most 20 000 places per venue. Section names are unique within a venue, ignoring case. Names are 1–100 characters (sections 1–50), addresses 1–200.

Responses list each section's `capacity` (its seats, or its GA capacity), the venue's total `capacity` and `layoutLocked`. `POST`, `GET` and `PATCH` on one venue also list every seat (`id`, `row`, `number`), which you need to release individual seats; the venue list leaves seats out.

**The layout locks once tickets exist.** `PATCH` with `sections` replaces the whole layout (every section and seat gets a new ID), but only while no event at the venue has a released batch: after that it's a 409 `layout-locked` and nothing in the request is applied. Other fields can still change.

### Events

`POST /admin/events` takes `title` (1–200 characters), `performer` (1–200), `description` (1–5000), `category` (`CONCERT`, `TALK`, `MEETUP`), `venueId`, `startsAt`, `endsAt`, `salesOpenAt` (ISO 8601 date-times with `Z` or an offset), and optionally `slug`, `holdDurationSec` (60–3600, default 600), `maxTicketsPerOrder` (1–20, default 6) and the [drop settings](#ticket-drops-and-the-waiting-room) `waitingRoomEnabled` (default false), `admissionRatePerSec` (1–1000, default 10) and `admissionTokenTtlSec` (60–3600, default 600). Rules, checked against the [server clock](#the-server-clock):

| Rule                               | Error (400 `validation-error`, `errors[].path`) |
| ---------------------------------- | ----------------------------------------------- |
| `startsAt` is in the future        | `startsAt`: "Start time must be in the future"  |
| `endsAt` is after `startsAt`       | `endsAt`                                        |
| `salesOpenAt` is before `startsAt` | `salesOpenAt`                                   |
| The venue exists                   | `venueId`: "No venue with this ID"              |

`PATCH` changes only the fields sent. The time rules apply to the result (sending only `endsAt` is checked against the stored `startsAt`), and the future rule only to a `startsAt` that is sent. `venueId` can change only while the event has no batch (409 `layout-locked`). Cancelled events can't change at all.

**Slugs.** Without a `slug`, venues and events get one made from the name or title (`Midnight Echoes — Live!` → `midnight-echoes-live`); if it's taken, `-2`, `-3`, … is added. A `slug` you send is used as is (lower-case letters and digits separated by single hyphens, at most 100 characters) and is a 409 `slug-taken` if another venue (or event) has it.

### Event lifecycle

`DRAFT` ⇄ `PUBLISHED` (publish, unpublish); either can be cancelled, and `CANCELLED` is final.

| Action      | Allowed from         | Also needs                                                                                         |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `publish`   | `DRAFT`              | At least one batch (`event-has-no-batches`) and `startsAt` in the future (`event-already-started`) |
| `unpublish` | `PUBLISHED`          | No ticket sold or in an unexpired hold (`event-has-sales`); cancel the event instead               |
| `cancel`    | `DRAFT`, `PUBLISHED` | Nothing. Cancelled is final: no edits, batches, publishing or deleting                             |
| `DELETE`    | `DRAFT`              | No ticket sold or held and no orders (`event-has-sales`). Removes its batches and tickets          |

Any other combination is a 409 `event-status-conflict`. Each action answers 200 with the updated event. Changes to one event (edits, actions, batches) run one at a time, so concurrent requests can't publish an event while its last change is half applied.

### Ticket batches

A batch puts inventory on sale at one `priceCents` (0–1 000 000, i.e. up to $10 000; 0 is a free ticket). `POST /admin/events/{eventId}/batches` takes a `name` (1–100 characters), the price, an optional `releasesAt` and at least one of:

| Field              | Releases                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `seatedSectionIds` | Every seat of these seated sections that no earlier batch of the event released                           |
| `seatIds`          | These seats. A seat whose section is also in `seatedSectionIds` is a 400                                  |
| `gaSections`       | `[{ "sectionId", "quantity" }]`: that many places of each GA section, up to the capacity not yet released |

Each released seat or GA place becomes one ticket (inventory unit), `AVAILABLE`, at the batch price. The answer (201) is the batch with its ticket counts per section.

- **Scheduled release.** `releasesAt` defaults to now. A later time keeps the batch's tickets off sale until then (`released: false`); tickets sell only once both `releasesAt` and the event's `salesOpenAt` have passed. Move the [clock](#the-server-clock) to test it.
- **400 `validation-error`** when a section or seat isn't at the event's venue (`not_found`), or a section has the wrong type (`invalid_section_type`). `errors[].path` points at the item, e.g. `seatIds.3` or `gaSections.0.sectionId`. Duplicates in a list are a 400 too.
- **409 `inventory-already-released`** when a listed seat was released before, or every seat of a listed section was. **409 `ga-capacity-exceeded`** when a quantity is more than the section has left (`"Only 5 places left to release in Floor"`). Nothing is created when any item fails.
- Releases for one event run one at a time: concurrent requests never release a seat twice or exceed a GA capacity. One wins, the others get the 409.
- Batches can't be edited or deleted. Releasing to a cancelled event is a 409 `event-status-conflict`; once a batch exists, the venue layout and the event's venue are locked.

### Ticket counts

Events (`tickets`), batches and batch sections report `{ total, available, held, sold }` at the server clock. `held` counts tickets in an unexpired hold; once a hold's time passes its tickets count as `available` again, even before the [hold sweeper](#holding-tickets) releases them.

### Pagination

List endpoints take `page` (from 1, default 1) and `pageSize` (1–100, default 20) and answer `{ items, page, pageSize, total, totalPages }`. A page past the last one has no items but the same `total`; an empty list has `totalPages: 0`. Every list has a stable order with `id` as the last tiebreaker, so paging never skips or repeats an item while the data doesn't change.

## Email

The API sends email over SMTP (`SMTP_URL`). Locally that is [Mailpit](https://mailpit.axllent.org), which catches every message: read them in the inbox at <http://localhost:8025>, or through Mailpit's API from tests.

- Every email has an HTML and a plain-text part, `From` is `MAIL_FROM` (default `TestTix <no-reply@testtix.test>`), and links point at the web app (`WEB_BASE_URL`, default `http://localhost:5173`).
- The `Date` header follows the [server clock](#the-server-clock), so an email sent while the clock is frozen carries the frozen time.
- The verification email is sent while the request is handled: when the request returns, Mailpit has the message. The [e-ticket email](#e-ticket-email) comes from a background job and arrives later, so poll for email instead of reading once.

```sh
# Register (with a CSRF token, as in the login example), then read the verification email
jar=$(mktemp)
csrf=$(curl -s -c "$jar" http://localhost:3000/auth/csrf | jq -r .csrfToken)
curl -s -b "$jar" -c "$jar" -X POST http://localhost:3000/auth/register -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $csrf" -d '{"email":"ada@example.com","password":"Lovelace-1815","name":"Ada"}' > /dev/null
# The newest verification email to an address: -G with --data-urlencode encodes the query
id=$(curl -s -G http://localhost:8025/api/v1/search \
  --data-urlencode 'query=to:"ada@example.com" subject:"Verify your email address"' | jq -r '.messages[0].ID')
curl -s "http://localhost:8025/api/v1/message/$id" | jq -r .Text
```

Mailpit's search matches substrings and returns the newest message first. Use a unique recipient per test (Mailpit is shared, and old messages stay until it drops them at 1000), and check the exact address and subject in the result.

### Email verification

Registering sends **Verify your email address** with a link to `<WEB_BASE_URL>/verify-email?token=<token>`. The token is 43 URL-safe characters; the server stores only its SHA-256 hash. Unverified users can log in, but can't check out (from M4).

1. Read the email and take the `token` query parameter from the link.
2. `POST /auth/verify-email` with `{ "token": "…" }` → 204. It needs a CSRF token but no session, so the link works in any browser. `GET /auth/me` now shows `"emailVerified": true`.

Rules worth testing:

| Situation                                                        | Result                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The same link used again                                         | 204, no change: the first verification time stays                                                                                                |
| An unused link after `EMAIL_VERIFICATION_TTL_HOURS` (default 24) | 400 `verification-token-expired`. To test it, freeze the clock, register, then `advanceBy` 86 400 000 ms. One millisecond earlier it still works |
| A link from an older email, after a resend                       | 400 `verification-token-invalid`: only the newest link works                                                                                     |
| An unknown or malformed token                                    | 400 `verification-token-invalid`; an empty token is a 400 `validation-error`                                                                     |
| `POST /auth/verify-email/resend` without a session               | 401                                                                                                                                              |
| Resend for an already verified user                              | 409 `email-already-verified`, nothing is sent                                                                                                    |
| A fourth resend of one user within 15 minutes                    | 429 `rate-limited` with `Retry-After`, nothing is sent                                                                                           |
| The SMTP server is down                                          | Registration still succeeds (the account exists, unverified, and the failure is logged); resend answers 503                                      |

A resend issues a new link with a fresh expiry and emails it. Each user can ask for 3 resends per 15 minutes (`RATE_LIMIT_VERIFICATION_RESEND`); the next one is a 429 `rate-limited` until the window ends (see [Rate limits](#rate-limits)).

Users from [`POST /__test/sessions`](#logging-in-through-the-test-api) with `"emailVerified": false` get no email; call the resend endpoint with their session to get one. [Seeded](#seeded-accounts) `unverified@testtix.test` has no link either until it asks for one.

### E-ticket email

Once an order is `CONFIRMED`, the worker sends the customer **Your tickets for {event title}**, which is both the order confirmation and the e-tickets:

- The HTML part lists each ticket with its QR as an **inline image** (`<img src="cid:qr-<ticket id>@testtix">`, a PNG part with that `Content-ID`), its place, price and code; then the total and a link to `<WEB_BASE_URL>/orders/<order id>`. The text part has the same without the images (`Ticket code: <code>` per ticket).
- One **PDF attachment**, `testtix-tickets-<order id>.pdf`, with a page per ticket in the order's seat order, the same pages as [`GET /tickets/{ticketId}/pdf`](#tickets). So the PDF's page count is the order's ticket count, seated or GA.
- It arrives shortly after the order is confirmed, and at most once per order in normal operation. If sending fails (SMTP down) the job retries with backoff, and a recovery job queues it again for any `CONFIRMED` order whose email hasn't gone out 60 seconds (server clock) after confirmation. A crash right after the SMTP server accepted the message can send it twice (at least once), never zero times.
- Orders from [seed scenarios](#seed-scenarios) send no email.

Continuing the [checkout example](#checkout-and-orders) after its [webhook](#late-and-out-of-order-payments), this waits for its customer's ticket email and saves the PDF:

<!-- example: group=checkout -->

```sh
email=$(echo "$seed" | jq -r .holder.user.email)
# The newest ticket email to an address. It comes from a job: poll until it is there
until id=$(curl -s -G http://localhost:8025/api/v1/search \
  --data-urlencode "query=to:\"$email\" subject:\"Your tickets for\"" | jq -er '.messages[0].ID'); do
  sleep 1
done
part=$(curl -s "http://localhost:8025/api/v1/message/$id" | jq -r '.Attachments[0].PartID')
curl -s -o tickets.pdf "http://localhost:8025/api/v1/message/$id/part/$part"
```

Inline QR images are under `.Inline` in Mailpit's message JSON, each with its `ContentID`.

## Health and readiness

| Endpoint            | 200 when                               | Otherwise                                   |
| ------------------- | -------------------------------------- | ------------------------------------------- |
| `GET /health`       | the process can serve requests         | no response at all                          |
| `GET /health/ready` | Postgres and Redis both answer in time | 503, same body, the failing check is `down` |

```json
{ "status": "error", "checks": { "database": { "status": "up" }, "redis": { "status": "down" } } }
```

Each check times out after `HEALTH_CHECK_TIMEOUT_MS` (default 1000 ms). Right after the API starts, Redis can report `down` for a moment until its connection is established. To try the 503 path locally, stop Redis with `docker compose --project-directory . -f docker/compose.yml stop redis`, then start it again with `pnpm infra:up`. The API reconnects on its own.

Wait for readiness before a test run instead of sleeping:

```sh
until curl -sf http://localhost:3000/health/ready > /dev/null; do sleep 1; done
```

## Metrics

`GET /metrics` (no session, never rate-limited) answers in the Prometheus text format. A standalone worker serves its own on `WORKER_PORT` (3001). Besides the Node.js process defaults (`process_*`, `nodejs_*`), it has:

| Metric                                  | Type      | Labels                      | What it counts                                                                                                                                             |
| --------------------------------------- | --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testtix_http_requests_total`           | counter   | `method`, `route`, `status` | Responses, those of rejected requests included. `route` is the route pattern (`/events/:eventId/holds`), `(unmatched)` for 404s of unknown paths           |
| `testtix_http_request_duration_seconds` | histogram | `method`, `route`           | Time from request to response                                                                                                                              |
| `testtix_hold_requests_total`           | counter   | `outcome`                   | `POST /events/{eventId}/holds` that got past validation: `created`, `tickets_unavailable` (the 409 with the taken tickets) or `rejected` (any other error) |
| `testtix_held_tickets`                  | gauge     | `event_id`                  | Tickets in unexpired holds right now (events with none are left out)                                                                                       |
| `testtix_orders`                        | gauge     | `status`                    | Every order by the status you'd see (an unpaid order past its expiry is `EXPIRED`), all five statuses                                                      |
| `testtix_waiting_room_*`                | see below | `event_id`                  | Queue length, admissions and the admission rate ([waiting room](#ticket-drops-and-the-waiting-room))                                                       |
| `testtix_rate_limited_requests_total`   | counter   | `group`                     | 429s per [rate-limit group](#rate-limits)                                                                                                                  |
| `testtix_job_wait_seconds`              | histogram | `queue`, `name`             | Job lag: from when a background job was due until a worker started it (first attempts only; retries wait out a backoff)                                    |
| `testtix_job_duration_seconds`          | histogram | `queue`, `name`, `outcome`  | Run time of a job attempt, `completed` or `failed`                                                                                                         |
| `testtix_job_queue_jobs`                | gauge     | `queue`, `state`            | Jobs per queue (`hold-sweeper`, `order-processing`, `waiting-room`) that are `waiting`, `active`, `delayed` or `failed`                                    |

Where the numbers come from matters when you compare them across API instances:

- **Counters and histograms** (`*_total`, `*_seconds`) count what one process did; add instances up (`sum(rate(…))`). A restart starts them at 0, which `rate()` handles.
- **Gauges read from Postgres or Redis** (`testtix_held_tickets`, `testtix_orders`, `testtix_waiting_room_*`, `testtix_job_queue_jobs`) are read at scrape time, so every instance reports the same value: take one (`max(…)`), don't add them up. They follow the [server clock](#the-server-clock) like the API does: after `advanceBy` past a hold's expiry, its tickets leave `testtix_held_tickets` before any sweep. If Postgres or Redis is down, they are left out and the rest of the scrape still answers.
- **Job metrics** come from the process that runs the jobs: the API with the worker inside (`WORKER_IN_PROCESS=true`, the default), else the worker.

`POST /__test/reset` doesn't reset counters (they're per process), but the gauges read from the data follow it. To watch these on a dashboard, run the [observability profile](../README.md#dashboards-prometheus-and-grafana).

```sh
curl -s http://localhost:3000/metrics | grep -E '^testtix_(orders|hold_requests_total)'
```

## Test mode

Test mode gives testers hooks that a real shop would never expose: the test API under `/__test/*` and a server clock you can control. Turn it on with `TESTTIX_TEST_MODE=true` (`.env.example` sets it, so a local `.env` copied from it has test mode on; without a `.env` it is off). With test mode off, every `/__test/*` path answers 404 like any unknown route, and the clock is always the real time.

On startup the API logs a `TestMode` warning saying whether test mode is on and whether the test API is key-protected.

### Test API reference

Every endpoint is tagged `test` in the [OpenAPI spec](#api-basics), which documents its body and response in full. None needs a session or a CSRF token.

| Endpoint                       | Needs `X-Test-Key` (when configured) | What it does                                                                                     |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /__test/clock`            | no                                   | Reads the [server clock](#the-server-clock)                                                      |
| `POST /__test/clock`           | yes                                  | Freezes, moves forward or resets the server clock                                                |
| `POST /__test/reset`           | yes                                  | Puts back the [baseline data](#seed-data), empties waiting rooms and rate-limit counters         |
| `POST /__test/seed/{scenario}` | no (it only adds data)               | Adds a [seed scenario](#seed-scenarios): ready-made events, holds and orders with fresh IDs      |
| `POST /__test/sessions`        | no (it only adds data)               | Creates a user and [logs it in](#logging-in-through-the-test-api), returning a ready-made cookie |

Scenarios: `basic-catalogue`, `sold-out-event`, `one-seat-left`, `hold-about-to-expire`, `ga-meetup`, `ga-last-ticket`, `confirmed-order`, and the [ticket drops](#drop-scenarios) `drop-in-5-min`, `drop-open-now` and `large-venue-drop`.

The test API has its own [rate limit](#rate-limits) (`testApi` group, 300 per minute per client address by default; it doesn't use up the `default` budget). Every call to `/__test/*`, rejected ones included (401, 429, 404 for an unknown scenario under `/__test/seed/`), writes an audit line to the API log: message `Test API call`, context `TestApiAudit`, with `testApi: { method, path, status, ip, testKeySent, requestId, durationMs }`. The `X-Test-Key` value is never logged.

### Test API key

Some test endpoints affect everyone using the server: freezing the clock or wiping the data breaks every other tester's session on a shared instance such as the hosted demo. When the server sets `TEST_API_KEY` (at least 16 characters), those endpoints require the same value in an `X-Test-Key` header and answer 401 without it (with a `WWW-Authenticate` header). When `TEST_API_KEY` is unset, as it is locally, they are open. The [reference](#test-api-reference) above says which endpoints need it.

### The server clock

All server-side time (hold expiry, session expiry, ticket drops) comes from one clock. In test mode you can freeze it, move it forward or reset it, so time-dependent behaviour is testable through the API instead of by waiting. The clock state lives in Redis, so every API instance and background worker sees the same time.

The clock only changes server time. Browser time is separate: in UI tests, control it with your browser tool (for example Playwright's `page.clock`) as well.

`GET /__test/clock` reads it, and `POST /__test/clock` changes it and returns the result. Both return:

```json
{ "now": "2026-12-01T18:30:00.000Z", "mode": "frozen", "offsetMs": 856800000 }
```

| Field      | Meaning                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- |
| `now`      | Server time, ISO 8601 in UTC with milliseconds                                               |
| `mode`     | `real`: the real time. `frozen`: stopped at `now`. `offset`: running, shifted forward        |
| `offsetMs` | `now` minus the real time, in milliseconds. 0 in `real` mode, negative if frozen in the past |

The `POST` body holds exactly one of these (anything else is a 400 `validation-error`, as are unknown fields):

| Body                                     | Effect                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "freezeAt": "2026-12-01T19:30:00Z" }` | Stop the clock at that time, in the past or future. The time needs `Z` or an offset (`+01:00`). It replaces any earlier freeze or offset                                |
| `{ "advanceBy": 600000 }`                | Move forward by that many milliseconds (an integer from 1 to 31 622 400 000, i.e. 366 days). A frozen clock stays frozen at the later time; a running one keeps running |
| `{ "reset": true }`                      | Back to the real time                                                                                                                                                   |

The clock never moves backwards on its own: `advanceBy` only accepts positive values. To go back, freeze at an earlier time or reset. Concurrent `advanceBy` calls all count, even when they reach different API instances.

```sh
# Freeze, then jump 10 minutes ahead (e.g. past a seat hold's expiry)
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -d '{"freezeAt":"2026-12-01T19:30:00Z"}'
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -d '{"advanceBy":600000}'
# → {"now":"2026-12-01T19:40:00.000Z","mode":"frozen",...}

# Back to real time; add the key on a server that has one
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -H "X-Test-Key: $TEST_API_KEY" -d '{"reset":true}'
```

The clock is global to the server: reset it when your test is done, and don't run tests that change it in parallel against the same server.

## Seed data

The baseline data set (`pnpm db:seed` on an empty database, or [`POST /__test/reset`](#resetting-the-data) at any time) has four venues, eight named fixture events and 36 generated ones. It is deterministic: seeding twice gives identical rows, and every slug and ID below is the same on every machine and every run.

Dates are relative to the **seed day**: the UTC date of the server clock when the seed ran (so with a frozen test clock, the frozen date). Below, `D+21 23:30` means 21 days after the start of that day, at 23:30 UTC. Seeding at any time on the same day gives the same dates; seeding on another day shifts every date but keeps every ID. Venues are in the fictional city of Port Ellis (time zone `America/New_York`).

The baseline has three [accounts](#seeded-accounts) and no holds or orders: every ticket is `AVAILABLE`.

### Seeded accounts

| Email                     | Password               | ID                                     | Role       | Email verified |
| ------------------------- | ---------------------- | -------------------------------------- | ---------- | -------------- |
| `admin@testtix.test`      | `TestTix-admin-1`      | `019b76da-a800-788e-b36d-87227a4e2df8` | `ADMIN`    | yes            |
| `customer@testtix.test`   | `TestTix-customer-1`   | `019b76da-a800-7599-864c-1d5467501b78` | `CUSTOMER` | yes            |
| `unverified@testtix.test` | `TestTix-unverified-1` | `019b76da-a800-78a5-9bed-edb1c9007204` | `CUSTOMER` | no             |

They are shared by everyone using the server: on a shared instance, prefer [`POST /__test/sessions`](#logging-in-through-the-test-api) or a registration with a unique email, so tests don't log each other out or change each other's data.

### Venues

| Slug                | ID                                     | Layout                                                              |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `riverside-hall`    | `019b76da-a800-7fbc-a24e-2ac58eab7ced` | Seated: Stalls (rows A–J × 20 seats), Balcony (rows A–D × 16)       |
| `the-warehouse`     | `019b76da-a800-7664-aea7-0601ec1983ba` | Mixed: Standing Floor (GA, capacity 250), Mezzanine (rows A–C × 12) |
| `harbor-auditorium` | `019b76da-a800-7501-8b17-e21d3d3d2902` | Seated: Main Floor (rows A–H × 14)                                  |
| `loft-23`           | `019b76da-a800-7258-bef4-ba77cca0deac` | GA: Loft (capacity 60)                                              |

Seat rows are lettered from the front (`A`), and seats are numbered from 1 within a row.

### Fixture events

| Slug                               | ID                                     | Status, starts        | What it's for                                                                                      |
| ---------------------------------- | -------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `midnight-echoes-live`             | `019b76da-a800-7758-9ad4-dec842184578` | Published, D+21 23:30 | Seated concert. Stalls on sale at $89.00; the Balcony batch ($59.00) is only released at D+3 15:00 |
| `warehouse-sessions-static-lights` | `019b76da-a800-776b-a16b-343f20473dbe` | Published, D+10 00:00 | Mixed seated + GA: Standing $45.00 (250 GA tickets), Mezzanine $75.00 (36 seats)                   |
| `testing-in-production-safely`     | `019b76da-a800-7913-96f9-35b2f7f50dd5` | Published, D+7 23:00  | Talk, 112 seats at $25.00                                                                          |
| `flaky-tests-clinic`               | `019b76da-a800-709a-8e78-794ac8523db8` | Published, D+7 23:00  | GA meetup, 60 tickets at $10.00. Starts at the same time as the talk above (sort tiebreaker)       |
| `summer-sounds-preview`            | `019b76da-a800-76de-b7e6-667e253a5e53` | Published, D+60 23:00 | Not on sale yet: sales open at D+14 15:00                                                          |
| `season-opener-showcase`           | `019b76da-a800-748c-b62b-9a1a51bcaaa8` | Published, D−7 23:00  | Already happened (sales opened at D−60 15:00)                                                      |
| `unannounced-headliner`            | `019b76da-a800-7fdf-8a97-784175aa9759` | Draft, D+45 23:30     | Not in the public catalogue; no tickets released                                                   |
| `acoustic-night-cancelled`         | `019b76da-a800-7e6d-8fd4-edb91a27a3cb` | Cancelled, D+3 23:30  | Cancelled event                                                                                    |

Unless noted, sales opened at D−30 15:00, and every batch puts all seats (or GA places) of its sections on sale.

### Generated events

36 more published events, on sale since D−14 15:00, fill the catalogue for pagination, filters and search. Faker generates them with a fixed seed: concerts by made-up bands at Riverside Hall or The Warehouse, talks at Harbor Auditorium and meetups at Loft 23, starting between D+1 and D+90. Their slugs end in a number (`the-neon-owls-live-4`) and are stable too, but prefer the fixtures above in tests: the generated list may change when the seed is extended.

## Resetting the data

`POST /__test/reset` puts the server back into its baseline state in one call:

1. It resets the server clock to the real time, or freezes it at `freezeAt` if the body has one.
2. It deletes every row (users, sessions, holds, orders and scenario data included) and inserts the [baseline seed](#seed-data) for the clock's UTC date.
3. It empties every [waiting room](#ticket-drops-and-the-waiting-room): queue and admission tokens stop working.
4. It clears every [rate-limit](#rate-limits) counter.

The data swap is one database transaction: while it runs, other requests wait or see the old data, never an empty or half-seeded database. Concurrent resets run one after the other. On a server with a [test API key](#test-api-key) it needs `X-Test-Key`.

The body is optional. Send none (or `{}`) to reset the clock, or `{ "freezeAt": "<ISO date-time>" }` (with `Z` or an offset) to freeze it. Resetting twice with a `freezeAt` on the same UTC day gives identical data, dates included; without it, the dates follow the real date. Unknown fields are a 400 `validation-error`.

```sh
curl -s -X POST http://localhost:3000/__test/reset
curl -s -X POST http://localhost:3000/__test/reset -H 'Content-Type: application/json' \
  -d '{"freezeAt":"2026-12-01T10:00:00Z"}'
```

```json
{
  "seedDay": "2026-12-01",
  "clock": { "now": "2026-12-01T10:00:00.000Z", "mode": "frozen", "offsetMs": 842070954 },
  "rows": {
    "users": 3,
    "venues": 4,
    "sections": 6,
    "seats": 412,
    "events": 44,
    "ticketBatches": 56,
    "inventoryUnits": 6370
  }
}
```

`seedDay` is `D` in the [fixture tables](#fixture-events). `rows` counts what was inserted; every other table is empty.

Run it before a test suite (or each test that needs the baseline), not in parallel with other tests against the same server: it logs everyone out and removes their data.

## Seed scenarios

`POST /__test/seed/{scenario}` adds a ready-made situation that the baseline doesn't have and answers 201 with the IDs it created. Scenarios only **add** rows: each call creates its own venue, events and (where needed) a buyer and orders, with fresh IDs. Every slug and title ends in a random 8-character suffix, so calls never collide, existing data isn't touched, and parallel tests can each create their own data. That is also why scenarios stay open on a server with a test API key.

Scenario data stays until the next reset. It is real data: scenario events are published and appear in the public catalogue next to the baseline. To find just your run's events, search for its suffix.

Dates are relative to the clock's UTC day (`D`), like the baseline: every scenario event starts at D+7 to D+14, at 23:00 UTC, and has been on sale since D−1 15:00, except the [drops](#drop-scenarios), whose sales open at a time relative to now. Rows get `createdAt` = the server clock. Unknown scenario names answer 404; a body a scenario doesn't accept is a 400 `validation-error`.

| Scenario               | Creates                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic-catalogue`      | A venue with Seats (rows A–C × 6) and Standing (GA, capacity 20), and three published events on sale: a concert using both ($40.00 seats, $25.00 standing), a seated talk ($15.00) and a GA meetup ($5.00)                                      |
| `sold-out-event`       | A published concert on sale whose 12 tickets (Seats rows A–B × 4 at $50.00, Standing GA capacity 4 at $30.00) are all sold, through confirmed orders of a new buyer (at most 6 tickets per order)                                               |
| `one-seat-left`        | A published concert on sale with 8 seats (rows A–B × 4, $45.00); all are sold through confirmed orders except row B seat 4                                                                                                                      |
| `hold-about-to-expire` | A published concert on sale with 8 seats (rows A–B × 4, $45.00); a new customer (the _holder_) holds row A seats 1–2 until `expiresInSec` from now (body, 1–600, default 60). The response logs the holder in                                   |
| `ga-meetup`            | A published GA-only meetup on sale with Floor (40 places: 20 at $10.00, then 20 at $15.00) and Balcony (10 places at $20.00)                                                                                                                    |
| `ga-last-ticket`       | A published GA meetup on sale whose Floor (10 places, $8.00) has one place left; the other nine are sold through confirmed orders                                                                                                               |
| `confirmed-order`      | A published concert on sale (Seats rows A–B × 4 at $45.00, Standing GA of 10 at $25.00); a new customer has a `CONFIRMED` order ($115.00) for row A seats 1–2 and one Standing place, with its three tickets. The response logs the customer in |
| `drop-in-5-min`        | A [ticket drop](#drop-scenarios) of 100 tickets (Seats rows A–E × 10 at $60.00, Standing GA of 50 at $35.00) whose sales open 5 minutes from now                                                                                                |
| `drop-open-now`        | The same drop with sales open from now                                                                                                                                                                                                          |
| `large-venue-drop`     | A drop of 10 000 tickets for load tests (Stalls rows A–AN × 50 at $75.00, Floor GA of 8 000 at $50.00), opening in 5 minutes unless the body says otherwise                                                                                     |

Buyers are customers with a verified email `buyer-<suffix>@scenario.testtix.test` and no usable password: nobody can log in as them. The holder of `hold-about-to-expire` (`holder-<suffix>@scenario.testtix.test`) has no password either, but the response includes a session for them (`holder`, the same shape as [`POST /__test/sessions`](#logging-in-through-the-test-api)), so a test can act as the holder at once, e.g. watch the countdown and the expiry. The same goes for the customer of `confirmed-order` (`customer-<suffix>@scenario.testtix.test`, session in `customer`), whose response also lists the order's tickets (`id`, `code`, section, seat, price) for [downloading](#tickets). Scenario orders are `CONFIRMED`, every sold ticket has a ticket code, and no [e-ticket email](#e-ticket-email) is sent for them.

```sh
curl -s -X POST http://localhost:3000/__test/seed/one-seat-left
```

Every response has a `venue` (ID, slug, name and sections with their IDs) and the events, each with its ID, slug, title, category, status, `startsAt`, `salesOpenAt`, `holdDurationSec`, `maxTicketsPerOrder`, its [waiting-room](#ticket-drops-and-the-waiting-room) settings and a ticket count by status:

```json
{
  "venue": {
    "id": "019ac6b2-…",
    "slug": "scenario-venue-3f9a1c2b",
    "name": "Scenario Venue 3f9a1c2b",
    "sections": [{ "id": "019ac6b2-…", "name": "Seats", "type": "SEATED", "capacity": null }]
  },
  "event": {
    "id": "019ac6b2-…",
    "slug": "one-seat-left-3f9a1c2b",
    "title": "One Seat Left 3f9a1c2b",
    "category": "CONCERT",
    "status": "PUBLISHED",
    "venueId": "019ac6b2-…",
    "startsAt": "2026-12-05T23:00:00.000Z",
    "salesOpenAt": "2026-11-20T15:00:00.000Z",
    "holdDurationSec": 600,
    "maxTicketsPerOrder": 6,
    "waitingRoomEnabled": false,
    "admissionRatePerSec": 10,
    "admissionTokenTtlSec": 600,
    "tickets": { "total": 8, "available": 1, "held": 0, "sold": 7 }
  },
  "buyer": { "id": "019ac6b2-…", "email": "buyer-3f9a1c2b@scenario.testtix.test" },
  "orderIds": ["019ac6b2-…", "019ac6b2-…"],
  "seat": {
    "id": "019ac6b2-…",
    "sectionId": "019ac6b2-…",
    "row": "B",
    "number": 4,
    "inventoryUnitId": "019ac6b2-…",
    "priceCents": 4500
  },
  "soldSeats": [{ "id": "019ac6b2-…", "row": "A", "number": 1, "…": "…" }]
}
```

| Scenario               | Response fields                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `basic-catalogue`      | `venue`, `events.concert`, `events.talk`, `events.meetup`                                                                         |
| `sold-out-event`       | `venue`, `event`, `buyer`, `orderIds`                                                                                             |
| `one-seat-left`        | `venue`, `event`, `buyer`, `orderIds`, `seat` (the available seat and its inventory unit), `soldSeats` (the seven others)         |
| `hold-about-to-expire` | `venue`, `event`, `holder` (user, session, `csrfToken`, `cookie`), `hold` (`id`, `createdAt`, `expiresAt`, `totalCents`, `seats`) |
| `ga-meetup`            | `venue`, `event`, `sections.floor`, `sections.balcony` (each with `capacity`, `available` and `prices`)                           |
| `ga-last-ticket`       | `venue`, `event`, `buyer`, `orderIds`, `section` (the Floor, `available: 1`)                                                      |
| `confirmed-order`      | `venue`, `event`, `customer` (like `holder`), `order` (`id`, `status`, `totalCents`, `tickets`)                                   |
| the three drops        | `venue`, `event`                                                                                                                  |

The OpenAPI spec documents each response in full.

### Drop scenarios

`drop-in-5-min`, `drop-open-now` and `large-venue-drop` each add one published concert with a [waiting room](#ticket-drops-and-the-waiting-room) (`waitingRoomEnabled: true`) at a new venue. Its `salesOpenAt` is relative to **now** on the server clock, in whole seconds (milliseconds dropped), and every batch is released at that moment, as an admin preparing a drop would set it. The event starts at D+14 23:00.

| Scenario           | Sales open                           | Tickets | `admissionRatePerSec` | `admissionTokenTtlSec` |
| ------------------ | ------------------------------------ | ------- | --------------------- | ---------------------- |
| `drop-in-5-min`    | now + 5 minutes                      | 100     | 5                     | 600                    |
| `drop-open-now`    | now                                  | 100     | 5                     | 600                    |
| `large-venue-drop` | now + `salesOpenInSec` (default 300) | 10 000  | 100                   | 600                    |

The body is optional. Every drop accepts `admissionRatePerSec` (1–1000) and `admissionTokenTtlSec` (60–3600) to override the defaults above; `large-venue-drop` also takes `salesOpenInSec` (0–86 400, 0 opens sales at once). Unknown fields are a 400.

- **Queues start empty.** Waiting rooms live in Redis, so a scenario can't fill one: customers join through `POST /events/{eventId}/queue`, each with its own session (for example from [`POST /__test/sessions`](#logging-in-through-the-test-api)).
- **Before or after the opening.** Customers who join `drop-in-5-min` (or `large-venue-drop` with a `salesOpenInSec`) before its opening are let in in a random order at the opening; customers of `drop-open-now` go in in join order, from the admission job's next run. Move the [clock](#the-server-clock) to the opening instead of waiting, as in the [waiting room example](#ticket-drops-and-the-waiting-room).
- **Watching one customer.** A UI test can queue many customers through the API and follow one of them in the browser: create the drop, queue the others, then log the watched customer in (with its session cookie) and open the event page.
- **Load runs** (`large-venue-drop`, sized for k6) create their customers with `POST /__test/sessions` and send [`X-Load-Test-Key`](#rate-limits) on every call, so the server's rate limits don't throttle them. With the default rate of 100 per second, 3 000 queued customers are all in after 30 seconds; at most 6 tickets per hold, 10 000 tickets last at least 1 667 holds.

```sh
# A large drop that opens in a minute and lets 50 customers in per second
curl -s -X POST http://localhost:3000/__test/seed/large-venue-drop -H 'Content-Type: application/json' \
  -d '{"salesOpenInSec":60,"admissionRatePerSec":50}' | jq '.event | {id, salesOpenAt, admissionRatePerSec, tickets}'
```

## Logging in through the test API

`POST /__test/sessions` creates a new user with a role and logs it in, in one call: API tests and UI tests that only need "a logged-in admin" skip registration, CSRF and login. Like the scenarios it only adds data, so it stays open on a server with a test API key, and it is exempt from the CSRF check.

| Field           | Required | Default                                          | Meaning                                                                                       |
| --------------- | -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `role`          | yes      |                                                  | `CUSTOMER` or `ADMIN`                                                                         |
| `email`         | no       | `user-<random>@session.testtix.test`             | Normalized like registration. 409 `email-already-registered` if it is taken                   |
| `name`          | no       | `Test Customer <random>` / `Test Admin <random>` |                                                                                               |
| `password`      | no       | none                                             | 8–128 characters. Lets the user also log in through `POST /auth/login` (e.g. a login UI test) |
| `emailVerified` | no       | `true`                                           | `false` gives an unverified user, who can log in but not check out                            |

Without `password` the user has no usable password: the returned session is the only way in. The call answers 201, sets the `testtix_session` and `testtix_csrf` cookies, and returns the same values in the body, plus a ready-made `Cookie` header for clients without a cookie jar:

```sh
session=$(curl -s -X POST http://localhost:3000/__test/sessions \
  -H 'Content-Type: application/json' -d '{"role":"ADMIN"}')
curl -s http://localhost:3000/auth/me -H "Cookie: $(echo "$session" | jq -r .cookie)"
```

```json
{
  "user": {
    "id": "019ac6b2-…",
    "email": "user-3f9a1c2b@session.testtix.test",
    "name": "Test Admin 3f9a1c2b",
    "role": "ADMIN",
    "emailVerified": true,
    "createdAt": "…"
  },
  "session": { "token": "…", "expiresAt": "2026-11-28T18:40:00.000Z" },
  "csrfToken": "…",
  "cookie": "testtix_session=…; testtix_csrf=…"
}
```

On state-changing requests, send `cookie` as the `Cookie` header and `csrfToken` as `X-CSRF-Token`. The session behaves like any other: it expires with the [server clock](#session-cookie), and `POST /auth/logout` ends it.

## Polling (`retryAfterMs`)

Two resources change on their own after you ask for them: an [order](#checkout-and-orders) (payment, processing, expiry) and a [queue entry](#ticket-drops-and-the-waiting-room) (position, admission). Both answer with **`retryAfterMs`**, and clients poll by it instead of a fixed interval:

1. Read the resource (`GET /orders/{orderId}`, `GET /queue/{token}`).
2. If `retryAfterMs` is a number, wait that many milliseconds and read it again.
3. If it is `null`, the resource is final for this purpose: stop.

| Resource                | `retryAfterMs` while it can change                                                               | `null` when                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `GET /orders/{orderId}` | `ORDER_POLL_INTERVAL_MS` (default 2000); while unpaid, never past `expiresAt`                    | `CONFIRMED`, `FAILED` or `EXPIRED` |
| `GET /queue/{token}`    | At most `QUEUE_POLL_INTERVAL_MS` (default 2000), at least 250; before the opening, never past it | `ADMITTED` or `EXPIRED`            |

What follows from it, for tests:

- **Don't poll faster.** The value already lands a poll on the next interesting moment (an expiry, the opening), and every poll counts towards the [rate limit](#rate-limits).
- **Don't sleep a fixed time** for something a job does (processing an order, sending the e-ticket email, letting a queue in): poll with a timeout. Jobs run on real time, a second or so after the trigger.
- **The web app polls the same way**, so a UI test with a fake browser clock moves it by `retryAfterMs` to get the next request. `retryAfterMs` follows the server clock: after `advanceBy`, the next answer reflects the new time.
- The values are server configuration: assert that they are positive and at most the configured interval, not exact numbers, unless you set the interval yourself.

```sh
# Poll until final (a confirmed order is final at once, so this reads it once)
API=http://localhost:3000
seed=$(curl -s -X POST $API/__test/seed/confirmed-order)
cookie=$(echo "$seed" | jq -r .customer.cookie); url="$API/orders/$(echo "$seed" | jq -r .order.id)"
while body=$(curl -s "$url" -H "Cookie: $cookie") && wait=$(echo "$body" | jq .retryAfterMs) && [ "$wait" != null ]; do
  sleep "$(jq -n "$wait / 1000")"
done
echo "$body" | jq -r .status   # → CONFIRMED
```

## Keeping tests independent

A TestTix server is often shared: by parallel workers of one suite, by several suites, or by everyone on the hosted demo. These patterns keep tests from seeing each other's data:

| You need                            | Use                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A logged-in user                    | [`POST /__test/sessions`](#logging-in-through-the-test-api): a new user per test, not the [seeded accounts](#seeded-accounts)         |
| An event in a given state           | A [seed scenario](#seed-scenarios): fresh IDs and a random suffix every call, so parallel tests never share an event                  |
| Your events in the catalogue        | Search for your run's suffix: `GET /events?q=<suffix>` (scenario titles end in it)                                                    |
| An email to read                    | A unique recipient per test (`ada+<run id>@example.com`): Mailpit is never emptied, so search by recipient and subject                |
| A waiting room                      | A drop scenario per test: queue positions are per event, so sharing a drop makes positions depend on other tests                      |
| Something expired, or a drop opened | Scenario parameters first (`expiresInSec`, `drop-open-now`, `salesOpenInSec`); moving the [clock](#the-server-clock) affects everyone |
| The baseline, or an exact data set  | [`POST /__test/reset`](#resetting-the-data), once before a suite that runs alone: it logs everyone out and removes all data           |

Rules of thumb:

- **Global state is serial.** The clock, `POST /__test/reset`, and the [baseline fixtures](#fixture-events) (holding or buying their seats) are shared by everyone. Run tests that change them one at a time, not in parallel with other tests against the same server, and reset the clock when done.
- **Assert on your own data.** Never count all events, orders or queue entries on a shared server; count those of your scenario (its IDs, its suffix).
- **Rate limits count per client address.** Parallel workers on one machine share one budget. Prefer test sessions to UI logins, and send `X-Load-Test-Key` from load runs; `POST /__test/reset` clears the counters.
- **Scenario data stays until the next reset.** That's harmless (nothing else uses it), so tests don't need to clean up after themselves.
