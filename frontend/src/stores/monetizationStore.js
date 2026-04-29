import { create } from 'zustand';

/**
 * Session-level monetization state:
 * - Every 3 completed games, next game requires rewarded ad.
 * - Premium categories require rewarded ad unlock per session.
 */
export const useMonetizationStore = create((set, get) => ({
  gamesPlayedThisSession: 0,
  premiumUnlockedThisSession: {},

  canStartNextGame: () => get().gamesPlayedThisSession < 3,

  onGameCompleted: () =>
    set((state) => ({ gamesPlayedThisSession: state.gamesPlayedThisSession + 1 })),

  onPlayGateRewardCompleted: () =>
    set({ gamesPlayedThisSession: 0 }),

  onPlayGateBypass: () =>
    set({ gamesPlayedThisSession: 2 }),

  isCategoryLocked: (category) => {
    if (!category?.is_premium) return false;
    return !get().premiumUnlockedThisSession[category.id];
  },

  onCategoryRewardCompleted: (categoryId) =>
    set((state) => ({
      premiumUnlockedThisSession: {
        ...state.premiumUnlockedThisSession,
        [categoryId]: true,
      },
    })),

  resetMonetizationSession: () =>
    set({
      gamesPlayedThisSession: 0,
      premiumUnlockedThisSession: {},
    }),
}));

/**
 * Gate a game start based on 3-games rule.
 * showRewardedAd should resolve { rewarded, status } where rewarded === true only on completion.
 */
export async function ensurePlayGateUnlocked(showRewardedAd) {
  const state = useMonetizationStore.getState();

  if (state.canStartNextGame()) {
    return true;
  }

  const result = await showRewardedAd();
  if (result?.rewarded) {
    useMonetizationStore.getState().onPlayGateRewardCompleted();
    return true;
  }

  if (result?.status && result.status !== 'closed') {
    // Fail-open if ad fails to load or times out to avoid soft-locks.
    useMonetizationStore.getState().onPlayGateBypass();
    return true;
  }

  return false;
}

/**
 * Gate premium category access for the current session.
 */
export async function ensureCategoryUnlockedForSession(category, showRewardedAd) {
  const state = useMonetizationStore.getState();

  if (!state.isCategoryLocked(category)) {
    return true;
  }

  const result = await showRewardedAd();
  if (!result?.rewarded) {
    return false;
  }

  useMonetizationStore.getState().onCategoryRewardCompleted(category.id);
  return true;
}
