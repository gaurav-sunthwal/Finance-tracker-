"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect, useMemo, useRef } from "react";
import { FinancialData, MonthlySummary, Transaction } from "@/lib/parser";
import { useFinanceStore } from "@/lib/store";
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Wallet, Activity, Mail, LogOut, Loader2, Calendar } from "lucide-react";
import { DayPicker, DateRange } from "react-day-picker";
import { format, isWithinInterval, startOfMonth, endOfMonth } from "date-fns";
import "react-day-picker/dist/style.css";

const COLORS = ['#818CF8', '#34D399', '#F472B6', '#FBBF24', '#A78BFA', '#60A5FA', '#F87171', '#34D399'];

export default function HomePage() {
  const { data: session, status } = useSession();

  // Hydration fix for Zustand persist (sessionStorage)
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Zustand Store - Using strict selectors for guaranteed re-renders
  const summaryData = useFinanceStore((state) => state.summaryData);
  const loading = useFinanceStore((state) => state.loading);
  const selectedMonthIndex = useFinanceStore((state) => state.selectedMonthIndex);
  const setSelectedMonthIndex = useFinanceStore((state) => state.setSelectedMonthIndex);
  const fetchTransactions = useFinanceStore((state) => state.fetchTransactions);
  const clearData = useFinanceStore((state) => state.clearData);

  // Calendar State
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Auto-fetch on load and window focus
    if (session?.accessToken && isMounted) {
      // 1. Initial fetch on load
      fetchTransactions();

      // 2. Instant Refetch on Tab/Window Focus
      // The moment the user switches back to this tab, fetch new transactions
      const onFocus = () => fetchTransactions(true);
      window.addEventListener("focus", onFocus);

      return () => {
        window.removeEventListener("focus", onFocus);
      };
    }
  }, [session, isMounted, fetchTransactions]);

  const handleSignOut = async () => {
    clearData(); // Clear cache on logout
    await signOut();
  };

  const financialData = summaryData?.financialData;
  const currentMonth: MonthlySummary | undefined = financialData?.monthlySummaries?.[selectedMonthIndex] || financialData?.monthlySummaries?.[0];

  // Derived data based on custom DateRange OR default month
  const displayData = useMemo(() => {
    if (!financialData) return null;

    let filteredTransactions = [];
    let periodLabel = currentMonth?.periodLabel || "Unknown";

    if (dateRange?.from) {
      // Custom date range selected
      const toDate = dateRange.to || dateRange.from;
      filteredTransactions = financialData.allTransactions.filter(tx => {
        const txDate = new Date(tx.date);
        return isWithinInterval(txDate, { start: dateRange.from!, end: toDate });
      });
      periodLabel = dateRange.to && dateRange.from !== dateRange.to
        ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`
        : format(dateRange.from, "MMM d, yyyy");
    } else {
      // Default to selected month
      filteredTransactions = currentMonth?.transactions || [];
    }

    let totalSpent = 0;
    let totalReceived = 0;
    const categoryBreakdown: { [category: string]: number } = {};

    filteredTransactions.forEach(t => {
      if (t.type === "debit") {
        totalSpent += t.amount;
        categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
      } else {
        totalReceived += t.amount;
      }
    });

    return {
      periodLabel,
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalReceived: Math.round(totalReceived * 100) / 100,
      netFlow: Math.round((totalReceived - totalSpent) * 100) / 100,
      categoryBreakdown,
      transactions: filteredTransactions,
      transactionCount: filteredTransactions.length
    };
  }, [financialData, currentMonth, dateRange]);

  // Prepare data for Category Pie Chart
  const categoryData = useMemo(() => {
    if (!displayData) return [];
    return Object.entries(displayData.categoryBreakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [displayData]);

  // Prepare data for Monthly Trend Bar Chart
  const trendData = useMemo(() => {
    if (!financialData) return [];
    // Take the most recent 6 months, then reverse for chronological order (left-to-right)
    return [...financialData.monthlySummaries].slice(0, 6).reverse().map(m => ({
      name: m.periodLabel.split(" ")[0].slice(0, 3), // e.g. "Sep"
      Spent: m.totalSpent,
      Income: m.totalReceived
    }));
  }, [financialData]);

  if (status === "loading" || !isMounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-slate-200">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-100 font-sans selection:bg-indigo-500/30">

      {/* Dynamic Background Gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-900/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-slate-100">FinanceTracker</h1>
              <p className="text-[11px] text-slate-400 font-medium tracking-wide uppercase">Gmail AI Parser</p>
            </div>
          </div>

          {session ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3 bg-white/5 py-1.5 px-3 rounded-full border border-white/10">
                {session.user?.image ? (
                  <img src={session.user.image} alt="User" className="w-6 h-6 rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs">
                    {session.user?.name?.[0] || "U"}
                  </div>
                )}
                <span className="text-xs font-medium text-slate-300 truncate max-w-[150px]">
                  {session.user?.email}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-300 py-2.5 px-4 rounded-xl border border-white/10 transition flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => signIn("google")}
              className="text-xs font-semibold bg-white text-black hover:bg-slate-200 py-2.5 px-5 rounded-xl transition shadow-lg flex items-center gap-2"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 pb-20 space-y-8">
        {!session ? (
          /* Unauthenticated state */
          <div className="mt-12 bg-white/[0.02] border border-white/5 rounded-3xl p-10 max-w-xl mx-auto text-center space-y-8 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50" />

            <div className="inline-flex p-4 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-inner">
              <Mail className="w-10 h-10" />
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl font-bold tracking-tight text-white">Automated Expense Tracking</h2>
              <p className="text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
                Connect your Google account to let our AI scan your mailbox for debit/credit alerts, UPI transactions, and shopping receipts securely.
              </p>
            </div>

            <button
              onClick={() => signIn("google")}
              className="w-full sm:w-auto mx-auto flex items-center justify-center gap-3 bg-white text-black hover:scale-105 active:scale-95 font-semibold py-3.5 px-8 rounded-2xl transition-all duration-300 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Continue with Google
            </button>
          </div>
        ) : (
          /* Authenticated Dashboard */
          <div className="space-y-6">

            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <div>
                <h2 className="text-xl font-bold text-white">Financial Dashboard</h2>
                <p className="text-xs text-slate-400 mt-0.5">Analyzing transactions from your mailbox.</p>
              </div>

              <button
                onClick={() => fetchTransactions(true)}
                disabled={loading}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-5 rounded-xl transition-all hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                {loading ? "Scanning Mailbox..." : "Sync Transactions"}
              </button>
            </div>

            {/* Error Display */}
            {summaryData?.error && (
              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-200 text-sm flex items-start gap-3">
                <span className="text-red-400 font-bold">⚠️ Error:</span>
                <p>{summaryData.error}</p>
              </div>
            )}

            {/* Main Content Area */}
            {financialData && financialData.monthlySummaries.length > 0 && displayData ? (
              <div className="space-y-6">

                {/* Month Selector Tabs & Date Picker */}
                <div className="relative" ref={calendarRef}>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
                    {/* Quick Month Tabs */}
                    {financialData.monthlySummaries.map((month, idx) => (
                      <button
                        key={month.monthKey}
                        onClick={() => {
                          setDateRange(undefined); // clear custom date
                          setSelectedMonthIndex(idx);
                        }}
                        className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${idx === selectedMonthIndex && !dateRange
                            ? "bg-white text-black shadow-lg"
                            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                          }`}
                      >
                        {month.periodLabel}
                      </button>
                    ))}

                    <div className="w-px h-6 bg-white/10 mx-2 shrink-0" />

                    {/* Custom Date Range Button */}
                    <button
                      onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                      className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${dateRange?.from
                          ? "bg-indigo-500 text-white shadow-[0_0_15px_-3px_rgba(99,102,241,0.5)]"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                        }`}
                    >
                      <Calendar className="w-4 h-4" />
                      {dateRange?.from ? displayData.periodLabel : "Custom Dates"}
                    </button>
                  </div>

                  {/* Calendar Popover */}
                  {isCalendarOpen && (
                    <div className="absolute top-14 left-0 sm:left-auto sm:right-0 z-50 bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl p-4 origin-top-left animate-in fade-in zoom-in-95 duration-200">
                      <style>{`
                        .rdp { --rdp-cell-size: 35px; --rdp-accent-color: #6366f1; --rdp-background-color: rgba(99, 102, 241, 0.1); margin: 0; }
                        .rdp-day_selected { font-weight: bold; }
                        .rdp-day_range_middle { background-color: rgba(99, 102, 241, 0.1); color: #c7d2fe; }
                        .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: rgba(255, 255, 255, 0.1); }
                        .rdp-day { color: #e2e8f0; border-radius: 8px; }
                        .rdp-nav_button { color: #e2e8f0; }
                        .rdp-nav_button:hover { background-color: rgba(255,255,255,0.1); }
                        .rdp-head_cell { color: #94a3b8; font-weight: 500; font-size: 0.8rem; }
                      `}</style>
                      <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center px-2">
                          <h4 className="text-sm font-semibold text-slate-200">Select Date Range</h4>
                          {dateRange?.from && (
                            <button
                              onClick={() => {
                                setDateRange(undefined);
                                setIsCalendarOpen(false);
                              }}
                              className="text-xs text-red-400 hover:text-red-300 font-medium bg-red-400/10 px-2 py-1 rounded"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <DayPicker
                          mode="range"
                          selected={dateRange}
                          onSelect={setDateRange}
                          max={60}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Hero Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-red-500/10 to-transparent border border-red-500/20 p-5 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                      <ArrowUpRight className="w-4 h-4 text-red-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">Total Spent</p>
                    <div className="flex items-baseline gap-3 mt-2">
                      <p className="text-3xl font-bold text-red-400 tracking-tight">
                        {financialData.currencySymbol}{displayData.totalSpent.toLocaleString()}
                      </p>
                      {!dateRange && financialData.monthlySummaries[selectedMonthIndex + 1] && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${displayData.totalSpent > financialData.monthlySummaries[selectedMonthIndex + 1].totalSpent
                            ? "bg-red-500/20 text-red-400"
                            : "bg-emerald-500/20 text-emerald-400"
                          }`}>
                          {displayData.totalSpent > financialData.monthlySummaries[selectedMonthIndex + 1].totalSpent ? "↑" : "↓"}
                          {Math.abs(Math.round(((displayData.totalSpent - financialData.monthlySummaries[selectedMonthIndex + 1].totalSpent) / (financialData.monthlySummaries[selectedMonthIndex + 1].totalSpent || 1)) * 100))}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 p-5 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <ArrowDownRight className="w-4 h-4 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">Total Received</p>
                    <div className="flex items-baseline gap-3 mt-2">
                      <p className="text-3xl font-bold text-emerald-400 tracking-tight">
                        {financialData.currencySymbol}{displayData.totalReceived.toLocaleString()}
                      </p>
                      {!dateRange && financialData.monthlySummaries[selectedMonthIndex + 1] && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${displayData.totalReceived > financialData.monthlySummaries[selectedMonthIndex + 1].totalReceived
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                          }`}>
                          {displayData.totalReceived > financialData.monthlySummaries[selectedMonthIndex + 1].totalReceived ? "↑" : "↓"}
                          {Math.abs(Math.round(((displayData.totalReceived - financialData.monthlySummaries[selectedMonthIndex + 1].totalReceived) / (financialData.monthlySummaries[selectedMonthIndex + 1].totalReceived || 1)) * 100))}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="bg-white/[0.02] border border-white/5 p-5 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                      <Wallet className="w-4 h-4 text-indigo-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">Net Flow</p>
                    <p className={`text-3xl font-bold mt-2 tracking-tight ${displayData.netFlow >= 0 ? "text-emerald-400" : "text-white"}`}>
                      {financialData.currencySymbol}{displayData.netFlow.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Category Pie Chart */}
                  <div className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-sm font-semibold text-slate-200 mb-6 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      Spending by Category
                    </h3>
                    {categoryData.length > 0 ? (
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={categoryData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                              stroke="none"
                            >
                              {categoryData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              formatter={(value: any) => [`${financialData.currencySymbol}${value}`, 'Amount']}
                              contentStyle={{ backgroundColor: '#18181B', border: '1px solid #27272A', borderRadius: '12px', fontSize: '12px' }}
                            />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#94A3B8' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[250px] flex items-center justify-center text-sm text-slate-500">No category data</div>
                    )}
                  </div>

                  {/* Monthly Trend Bar Chart */}
                  <div className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-sm font-semibold text-slate-200 mb-6 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      6-Month Trend
                    </h3>
                    {trendData.length > 0 ? (
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                            <XAxis dataKey="name" stroke="#52525B" fontSize={11} tickLine={false} axisLine={false} />
                            <YAxis stroke="#52525B" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}`} />
                            <RechartsTooltip
                              cursor={{ fill: '#27272A', opacity: 0.4 }}
                              contentStyle={{ backgroundColor: '#18181B', border: '1px solid #27272A', borderRadius: '12px', fontSize: '12px' }}
                            />
                            <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            <Bar dataKey="Spent" fill="#F87171" radius={[4, 4, 0, 0]} maxBarSize={40} />
                            <Bar dataKey="Income" fill="#34D399" radius={[4, 4, 0, 0]} maxBarSize={40} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[250px] flex items-center justify-center text-sm text-slate-500">No trend data</div>
                    )}
                  </div>
                </div>

                {/* Transaction List */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
                  <div className="p-5 border-b border-white/5 flex justify-between items-center bg-black/20">
                    <h3 className="text-sm font-semibold text-slate-200">Recent Transactions</h3>
                    <span className="text-[11px] font-medium bg-white/10 px-2.5 py-1 rounded-full text-slate-300">
                      {displayData.transactionCount} items
                    </span>
                  </div>

                  <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {displayData.transactions.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-500">
                        No transactions found for {displayData.periodLabel}.
                      </div>
                    ) : (
                      displayData.transactions.map((tx: Transaction) => (
                        <div key={tx.id} className="p-4 hover:bg-white/[0.03] transition-colors flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tx.type === "debit" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
                              }`}>
                              {tx.type === "debit" ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                            </div>
                            <div className="space-y-0.5 max-w-[200px] sm:max-w-md">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200 text-sm truncate">{tx.merchant}</span>
                                {tx.accountSnippet && (
                                  <span className="text-slate-500 text-[10px] bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                                    {tx.accountSnippet}
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-400 text-[11px] truncate group-hover:text-slate-300 transition-colors">{tx.subject}</p>
                              <div className="flex gap-2 text-[10px] text-slate-500 font-medium">
                                <span>{tx.formattedDate}</span>
                                <span>•</span>
                                <span className="text-indigo-400/80">{tx.category}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className={`font-bold text-sm tracking-tight ${tx.type === "debit" ? "text-white" : "text-emerald-400"}`}>
                              {tx.type === "debit" ? "-" : "+"}{tx.currency}{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            ) : (
              !loading && !summaryData?.error && (
                <div className="text-center p-12 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <p className="text-slate-400 text-sm">No transactions parsed yet. Click Sync Transactions.</p>
                </div>
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}
