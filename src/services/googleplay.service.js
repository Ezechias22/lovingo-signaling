// signaling_server/src/services/googleplay.service.js
const path = require('path');
const { google } = require('googleapis');

const PACKAGE_NAME =
  process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.lovingo2.app';

let cachedClient = null;

function getAuth() {
  if (cachedClient) return cachedClient;

  let credentials;

  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON invalid JSON');
    }

    cachedClient = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  } else {
    const keyFile = path.join(
      __dirname,
      '..',
      'config',
      'google-play-service-account.json'
    );

    cachedClient = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  }

  return cachedClient;
}

function getAndroidPublisher() {
  return google.androidpublisher({ version: 'v3', auth: getAuth() });
}

async function verifyProductPurchase({ productId, purchaseToken }) {
  const publisher = getAndroidPublisher();

  const { data } = await publisher.purchases.products.get({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken,
  });

  return data;
}

async function acknowledgeProduct({ productId, purchaseToken }) {
  const publisher = getAndroidPublisher();

  await publisher.purchases.products.acknowledge({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken,
    requestBody: {},
  });
}

async function consumeProduct({ productId, purchaseToken }) {
  const publisher = getAndroidPublisher();

  await publisher.purchases.products.consume({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken,
  });
}

async function verifySubscriptionPurchase({ purchaseToken }) {
  const publisher = getAndroidPublisher();

  const { data } = await publisher.purchases.subscriptionsv2.get({
    packageName: PACKAGE_NAME,
    token: purchaseToken,
  });

  return data;
}

async function acknowledgeSubscription({ subscriptionId, purchaseToken }) {
  const publisher = getAndroidPublisher();

  await publisher.purchases.subscriptions.acknowledge({
    packageName: PACKAGE_NAME,
    subscriptionId,
    token: purchaseToken,
    requestBody: {},
  });
}

module.exports = {
  PACKAGE_NAME,
  verifyProductPurchase,
  acknowledgeProduct,
  consumeProduct,
  verifySubscriptionPurchase,
  acknowledgeSubscription,
};
