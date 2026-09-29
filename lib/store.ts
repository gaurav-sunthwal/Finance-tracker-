import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { FinancialData } from "./parser";

interface FinanceState {
  summaryData: {
    summaryMessage?: string;
    financialData?: FinancialData;
    error?: string;
  } | null;
  loading: boolean;
  selectedMonthIndex: number;
  lastFetchedAt: number | null;
  setSummaryData: (data: any) => void;
  setLoading: (loading: boolean) => void;
  setSelectedMonthIndex: (index: number) => void;
  fetchTransactions: (force?: boolean) => Promise<void>;
  clearData: () => void;
}

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set, get) => ({
      summaryData: null,
      loading: false,
      selectedMonthIndex: 0,
      lastFetchedAt: null,

      setSummaryData: (data) => set({ summaryData: data }),
      setLoading: (loading) => set({ loading }),
      setSelectedMonthIndex: (index) => set({ selectedMonthIndex: index }),

      fetchTransactions: async (force = false) => {
        // Simple caching mechanism: don't fetch if fetched in last 5 minutes (300000ms), unless forced
        const { lastFetchedAt, summaryData } = get();
        const now = Date.now();
        
        if (!force && summaryData?.financialData && lastFetchedAt && now - lastFetchedAt < 300000) {
          console.log("Using cached financial data from session storage");
          return; // Skip fetch if cached and fresh
        }

        set({ loading: true, summaryData: null });
        try {
          const res = await fetch("/api/finance/sync");
          const data = await res.json();
          if (!res.ok) {
            set({
              summaryData: { error: data.error || data.details || "Failed to fetch transactions." },
              loading: false,
            });
          } else {
            set({
              summaryData: data,
              selectedMonthIndex: 0,
              lastFetchedAt: Date.now(),
              loading: false,
            });
          }
        } catch (err: any) {
          set({
            summaryData: { error: err.message || "An unexpected error occurred." },
            loading: false,
          });
        }
      },

      clearData: () => set({ summaryData: null, selectedMonthIndex: 0, lastFetchedAt: null }),
    }),
    {
      name: "finance-tracker-storage", // name of the item in the storage (must be unique)
      storage: createJSONStorage(() => sessionStorage), // use sessionStorage
    }
  )
);
