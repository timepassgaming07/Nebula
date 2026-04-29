import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import ENV from '../config/env';

// AdMob integration using react-native-google-mobile-ads
// This will only work in production builds (not Expo Go)
let BannerAd, BannerAdSize, TestIds;

try {
  const admob = require('react-native-google-mobile-ads');
  BannerAd = admob.BannerAd;
  BannerAdSize = admob.BannerAdSize;
  TestIds = admob.TestIds;
} catch (e) {
  // react-native-google-mobile-ads not available (e.g., in Expo Go)
  BannerAd = null;
}

export function AdBanner({ style }) {
  if (!BannerAd) {
    // Ads not available in this environment
    return null;
  }

  const adUnitId = Platform.select({
    ios: ENV.ADMOB_BANNER_ID_IOS,
    android: ENV.ADMOB_BANNER_ID_ANDROID,
  });

  return (
    <View style={[styles.bannerContainer, style]}>
      <BannerAd
        unitId={adUnitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{
          requestNonPersonalizedAdsOnly: true,
        }}
        onAdFailedToLoad={(error) => {
          console.log('Ad failed to load:', error);
        }}
      />
    </View>
  );
}

export function useInterstitialAd() {
  const [loaded, setLoaded] = useState(false);
  const [ad, setAd] = useState(null);

  useEffect(() => {
    try {
      const { InterstitialAd, AdEventType } = require('react-native-google-mobile-ads');

      const adUnitId = Platform.select({
        ios: ENV.ADMOB_INTERSTITIAL_ID_IOS,
        android: ENV.ADMOB_INTERSTITIAL_ID_ANDROID,
      });

      const interstitial = InterstitialAd.createForAdRequest(adUnitId, {
        requestNonPersonalizedAdsOnly: true,
      });

      const unsubscribe = interstitial.addAdEventListener(AdEventType.LOADED, () => {
        setLoaded(true);
      });

      interstitial.load();
      setAd(interstitial);

      return () => unsubscribe();
    } catch (e) {
      // Ads not available
    }
  }, []);

  const showAd = () => {
    if (ad && loaded) {
      ad.show();
      setLoaded(false);
      // Reload for next time
      setTimeout(() => ad.load(), 1000);
    }
  };

  return { loaded, showAd };
}

const styles = StyleSheet.create({
  bannerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
