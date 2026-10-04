# Setting up a tenant's base data

What to fill in, and in what order, when configuring a tenant from scratch — a
fresh production tenant, or a local one after `make dev-reset`.

Each step builds on entities created in the ones before it, so working
top-to-bottom means you always have something to link to. Jumping ahead leaves
you with empty dropdowns.

Paths below are relative to the tenant's own host — locally that's
`http://test.localhost:3000`, in production the tenant's subdomain.

## 1. Share types and their sizes

**`/configuration/subscriptions`**

Define every share type the CSA offers (e.g. harvest share, bread share) along
with its size variations (e.g. S / M / L).

These are the products members subscribe to, and everything downstream —
forecasts, planning, packing, invoicing — is built on top of them, so they come
first.

## 2. Delivery days

**`/configuration/time-management`**

Set up the weekly days on which shares are handed out. They define the rhythm of
the season and are referenced by stations, tours, and the harvest/packing lists,
so they need to exist before any of those.

## 3. The master lists — produce and pickup points

- **Share articles** — the actual goods that make up a share (vegetables, bread,
  …): **`/commissioning/list-harvest-share-articles`**
- **Delivery stations** — the physical points where members collect their
  shares: **`/commissioning/list-delivery-stations`**

## 4. Assign delivery days to each station

**`/commissioning/list-delivery-stations`** → open a station's modal

A station only operates on certain delivery days; linking the two tells the
system which station is active on which day. This is what the harvest/packing
and station-overview screens scope by.

## 5. Assign the stations to tours

**`/commissioning/delivery-tours`**

Group the stations into the routes a driver actually takes. Tours drive the
per-tour breakdowns shown in the packing list and the station overview, so they
come last, once every station exists and has its delivery days.

---

Once these five are in place the operational screens (forecast, harvesting list,
packing list, station overview) have everything they need, and members can be
imported or invited. For an onboarding of more than 1000 members, do step 6
first.

## 6. Before a large import: raise the weekly limits

Each tenant can create at most 1000 members, invite 1000 users and confirm 1000
subscriptions in any 7 days. The limits stop a compromised office account from
flooding the tenant, but a bigger onboarding runs into them:

- A member import reserves one slot per row up front and refuses the whole file
  if its rows don't fit into what is left of the week. Splitting the file
  doesn't help: every part draws on the same weekly limit.
- Inviting a member to their account and confirming a subscription count one
  each.

Only the platform operator can raise the limits: they are part of the tenant's
platform record, out of the office's reach on purpose. Before the import, open
the tenant's page in the platform admin and, under **Rate limits**, enter weekly
limits with headroom over the number of members for *Member creation*, *User
creation* and *Subscription confirmation*. A blank field keeps the default, and
saving asks you to confirm your identity again.

A single upload takes at most 5000 rows, so split a bigger file once the limits
are raised.

When the onboarding is done, clear those fields again so the protective defaults
apply. If the tenant had raised limits before, restore those instead.

## 7. Email from the tenant's own domain

Jasmin sends the tenant's mail — invitations, password resets, invoices, offers
— through the tenant's own mail server, set up under Configuration → Email. A
successful test email there only proves that the server accepts Jasmin's login.
Whether Gmail, Outlook and the rest trust the mail depends on three DNS records
for the sending domain, the part after the @ in the sender address. Without
them, invitations and password resets land in spam.

The records go in at the domain's DNS host (Strato, IONOS, Cloudflare, …) — not
in a mailbox and not in Jasmin. They don't change how the existing mailboxes
work.

- **SPF**, a TXT record on the domain listing the servers that may send for it.
  The value comes from the mail provider's help pages, for example
  `v=spf1 include:_spf.google.com ~all` for Google Workspace or
  `v=spf1 include:spf.protection.outlook.com -all` for Microsoft 365; Strato,
  IONOS and mailbox.org publish theirs the same way. A domain may have only one
  SPF record: if there is one already, add the provider's `include:` to it
  instead of creating a second. If the tenant already sends mail from the domain
  through the same provider, it is probably right already.
- **DKIM**, the public key the provider signs each message with, as a CNAME or
  TXT record whose name ends in `._domainkey`. Every provider generates its own;
  its admin pages show exactly what to enter.
- **DMARC**, a TXT record named `_dmarc` that tells receivers what to do with
  mail failing SPF and DKIM, and where to send their reports. Tighten it in
  steps, each once the reports show all legitimate mail passing:
  1. `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` — only reports;
  2. `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>` — failing mail goes
     to spam;
  3. `v=DMARC1; p=reject; rua=mailto:dmarc@<domain>` — failing mail is refused.

To check the result, send a mail from the domain to a checker such as
mail-tester.com, or look the domain up on mxtoolbox.com. In Gmail, "Show
original" on a received mail lists SPF, DKIM and DMARC as PASS or FAIL.

While there, set **Max emails per hour** under Configuration → Email to the
provider's limit. Jasmin sends nothing past it in any hour — those emails show
as not sent in the email log — so a large offer or reminder run can't get the
account blocked.
