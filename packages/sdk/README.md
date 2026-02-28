# @uynis/sdk

TypeScript SDK for Uynis API integrations.

Base URL resolution order:

1. constructor option `baseUrl`
2. `UYNIS_SDK_BASE_URL`
3. `UYNIS_API_URL`
4. `http://localhost:4000`

Example:

```ts
import { UynisClient } from '@uynis/sdk';

const client = new UynisClient({ baseUrl: 'https://api.example.com' });
await client.login('user@example.com', 'password');
const me = await client.getMe();
console.log(me);
```

---
Written by Krishnam Murarka (km@edilec.com)

