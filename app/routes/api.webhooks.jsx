import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case 'APP_UNINSTALLED':
      if (session) {
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    case 'CUSTOMERS_DATA_REQUEST':
      // Handle customer data request (GDPR)
      // TODO: Implement data export logic if storing customer data
      break;
    case 'CUSTOMERS_REDACT':
      // Handle customer data deletion (GDPR)
      // TODO: Implement data deletion logic if storing customer data
      break;
    case 'SHOP_REDACT':
      // Handle shop data deletion (GDPR)
      // TODO: Implement shop data deletion logic if storing shop data
      break;
    default:
      throw new Response('Unhandled webhook topic', { status: 404 });
  }

  return new Response();
};
