# ezCloud support broker

Local API for ezID presence tokens, support tickets, and ACL-gated admin routes. Desktop `/v1/*` routes are not ACL-gated. Admin routes read `ACL_BASE_URL`, `ACL_API_KEY`, and `ACL_MODE` from the environment. There is no configuration page.

```bash
npm install
npm test
npm start
```

Contract: `specs/001-ezid-customer-support/contracts/broker.openapi.yaml`. Copy `.env.example` to `.env` and set `EZCLOUD_JWT_SECRET` before `npm start`. The same secret is `EZCLOUD_JWT_SECRET` on `hbbs` and `hbbr`. Set `EZCLOUD_AUTH_REQUIRED=Y` on those processes when registration must carry a presence token.
