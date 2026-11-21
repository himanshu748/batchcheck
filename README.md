# BatchCheck

BatchCheck helps print shops and customers catch discrepancies before a batch goes into production. Both parties independently enter the quantity, garment, print colour, and artwork version. After both submit, they compare entries and discuss differences in a field-specific chat. One party proposes a correction and the other confirms it. A batch locks once both parties approve the reconciled specs.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm test
npm run build
npm start
```

Open the [buyer inbox](http://127.0.0.1:4173/workspace/?inbox=buyer) and [print shop inbox](http://127.0.0.1:4173/workspace/?inbox=shop) in separate tabs. Sample messages and order updates sync between tabs in the same browser profile. The inbox lists each field thread and highlights proposals that need a reply from its current role. Choose **Start blank readback** under **Demo workspace** to try the flow from the beginning.

## Configure live chat

1. Create a free Web app in the [Nexconn Console](https://console.nexconn.ai/agile/login/vcode). This build supports Singapore and North America. Copy `.env.example` to `.env`.
2. Set `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, and the matching `NEXCONN_REGION` in server environment variables. Keep the App Secret out of the frontend, source repository, demo video, and submission write-up.
3. Generate four independent values with `node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))'`. Put one in each of `NEXCONN_BUYER_ID`, `NEXCONN_SHOP_ID`, `BUYER_ACCESS_CODE`, and `SHOP_ACCESS_CODE`.
4. Optionally set the batch ID, order title, and participant names before the first readback. Each deployment serves one active two-party workspace. Use a fresh batch ID for a new job. Use `BATCH_DATABASE` to place the SQLite file on persistent storage. Keep its directory writable.
5. For a hosted instance set `HOST=0.0.0.0`, serve it behind HTTPS, and provide each participant only their own workspace access code. Click **Go live** in two separate browser profiles or devices and enter the corresponding codes. Access codes unlock one role each and should remain private.

Live mode uses the Nexconn Chat SDK to send and receive field-specific text messages and retrieve recent conversation history. The app server issues user tokens using the Nexconn Platform Chat API. The browser receives a token for its own role, and an explicit inbox link accepts only that role's code. SQLite stores durable readbacks, proposals, and approvals. Authenticated order updates stream to both inboxes, with polling as a fallback. The order API checks the revision on each write so two browsers cannot approve competing versions. Reopening a field clears previous approvals.

## Try it in under two minutes

1. Start with the sample where the buyer entered 80 and the shop entered 60. For the live flow, start from blank and enter these values independently in the two roles. Use the same garment, print colour, and artwork for the other fields.
2. As the shop, send a message in the Quantity thread and propose 80. As the buyer, confirm the message and accept the proposed quantity.
3. Approve as one party. Switch roles and approve again. Download the production receipt and verify the agreed quantity is 80 shirts and the original print-shop readback was 60.
4. To show the revision safeguard, repeat and reopen Artwork after the first approval. Check that approvals clear, settle an updated artwork value, then approve again.

## Submission materials

The [organizer's rules](https://reskilll.com/hack/nexconn/rules) require a live runnable URL, a demo video, a public GitHub repo, and a PDF write-up with the public Nexconn App Key. A browser-only walkthrough demonstrates the interface. Use the configured live workspace to record actual two-device SDK delivery and collect real tester feedback.

Suggested write-up:

> BatchCheck gives customers and print shops a shared record of the specs they have agreed to produce. Each party records their interpretation independently, which surfaces disagreements about quantities, garment, ink, and artwork. They discuss a specific mismatch through Nexconn Chat, agree a correction, and sign off on a revision. Both approvals are recorded in a downloadable production receipt. Nexconn powers the live field chat and history. The order server verifies proposals and approvals against the current revision.
