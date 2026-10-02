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

Only the platform operator can raise the limits. They are stored on the
tenant's platform record (`Tenant.action_rate_limit_overrides`), out of the
office's reach on purpose. Before the import, raise them on the server, with
headroom over the number of members; replace `<schema>` with the tenant's
schema name:

```shell
docker compose exec backend python manage.py shell -c "
from apps.shared.tenants.models import Tenant
tenant = Tenant.objects.get(schema_name='<schema>')
tenant.action_rate_limit_overrides = {
    'member_creation': {'weekly': 5000},
    'user_creation': {'weekly': 5000},
    'subscription_confirmation': {'weekly': 5000},
}
tenant.save(update_fields=['action_rate_limit_overrides'])
"
```

A single upload takes at most 5000 rows, so split a bigger file once the limits
are raised.

When the onboarding is done, put the limits back so the protective defaults
apply again. If the tenant had overrides before, restore those instead:

```shell
docker compose exec backend python manage.py shell -c "
from apps.shared.tenants.models import Tenant
tenant = Tenant.objects.get(schema_name='<schema>')
tenant.action_rate_limit_overrides = {}
tenant.save(update_fields=['action_rate_limit_overrides'])
"
```
