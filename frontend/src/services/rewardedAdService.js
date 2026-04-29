import { Alert, Platform } from 'react-native';
import ENV from '../config/env';

let RewardedAd;
let RewardedAdEventType;
let AdEventType;
let TestIds;

try {
  const admob = require('react-native-google-mobile-ads');
  RewardedAd = admob.RewardedAd;
  RewardedAdEventType = admob.RewardedAdEventType;
  AdEventType = admob.AdEventType;
  TestIds = admob.TestIds;
} catch (e) {
  RewardedAd = null;
}

function getRewardedUnitId() {
  const configuredUnit = Platform.select({
    ios: ENV.ADMOB_REWARDED_ID_IOS,
    android: ENV.ADMOB_REWARDED_ID_ANDROID,
  });

  if (configuredUnit && !configuredUnit.includes('ca-app-pub-3940256099942544')) {
    return configuredUnit;
  }

  return TestIds?.REWARDED || configuredUnit;
}

function devFallbackRewardPrompt() {
  return new Promise((resolve) => {
    Alert.alert(
      'Rewarded Ad',
      'Rewarded ads are not available in this runtime. Simulate an earned reward for development?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve({ rewarded: false, status: 'unavailable' }) },
        { text: 'Simulate Reward', onPress: () => resolve({ rewarded: true, status: 'rewarded' }) },
      ]
    );
  });
}

export async function showRewardedAd() {
  if (!RewardedAd || !RewardedAdEventType || !AdEventType) {
    if (__DEV__) return devFallbackRewardPrompt();
    Alert.alert('Ad unavailable', 'Rewarded ads are currently unavailable. Please try again later.');
    return { rewarded: false, status: 'unavailable' };
  }

  return new Promise((resolve) => {
    const adUnitId = getRewardedUnitId();

    if (!adUnitId) {
      resolve({ rewarded: false, status: 'unavailable' });
      return;
    }

    const rewardedAd = RewardedAd.createForAdRequest(adUnitId, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubscribers = [];
    let hasSettled = false;

    let timeoutId = null;

    const settle = (result) => {
      if (hasSettled) return;
      hasSettled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(result);
    };

    unsubscribers.push(
      rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        settle({ rewarded: true, status: 'rewarded' });
      })
    );

    unsubscribers.push(
      rewardedAd.addAdEventListener(AdEventType.LOADED, async () => {
        try {
          await rewardedAd.show();
        } catch (error) {
          settle({ rewarded: false, status: 'failed' });
        }
      })
    );

    unsubscribers.push(
      rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
        settle({ rewarded: false, status: 'closed' });
      })
    );

    unsubscribers.push(
      rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
        settle({ rewarded: false, status: 'failed' });
      })
    );

    rewardedAd.load();

    timeoutId = setTimeout(() => {
      settle({ rewarded: false, status: 'timeout' });
    }, 30000);
  });
}
