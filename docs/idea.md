# TestTix — Idea

An event ticket shop: a fictional venue or festival that sells tickets to concerts, talks and meetups. Ticket sales naturally produce almost every failure mode worth showing, and the domain doesn't overlap with Toolshop (a tool store) or restful-booker (a B&B).

## Why tickets fit

- **Scarcity creates real race conditions.** Two users try to buy the last seat at the same moment. That's a classic bug, and a great test case for both the app and the test suite.
- **Seat holds rely on timers.** "Your seats are held for 10 minutes" is exactly the kind of clock-dependent logic that makes tests flaky. It's a natural place to show Playwright's clock control instead of `waitForTimeout`.
- **Ticket drops are the textbook load test.** Sales open at 10:00, thousands of users arrive at once, a waiting room queues them. That gives k6 work a believable story.
- **Checkout happens in the background.** Payment confirmation and ticket delivery run as background jobs, so the order shows "processing" before "confirmed" and the ticket arrives by email (Mailpit). It's the "data appears eventually" scenario, done realistically.
- **Seat maps are notoriously hard to make accessible.** Keyboard navigation, screen-reader labels, colour-only "available/taken" states. It makes a strong, realistic accessibility demo.
- **Everyone understands it.** No domain to explain in blog posts or talks.

## Features mapped to failure modes

| Feature                                      | What it lets you demo                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Event list with filters and search           | Nondeterministic ordering, debounced search, pagination      |
| Seat map selection                           | Complex UI locators, accessibility violations                |
| Seat hold with countdown                     | Clock control, time-dependent tests                          |
| Buying the last seat                         | Race conditions, test data isolation                         |
| Ticket drop + waiting room                   | k6 load scenarios, the queue under load                      |
| Async checkout + emailed ticket              | Eventual consistency, polling vs. fixed waits, email testing |
| Admin: create events, release ticket batches | Role-based tests, API-based data setup                       |
