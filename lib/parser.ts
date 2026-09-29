export interface Transaction {
  id: string;
  emailId: string;
  subject: string;
  sender: string;
  date: string;
  formattedDate: string;
  amount: number;
  currency: string;
  type: "debit" | "credit";
  merchant: string;
  category: string;
  accountSnippet?: string;
  rawSnippet: string;
}

export interface FinancialSummary {
  totalSpentThisMonth: number;
  totalReceivedThisMonth: number;
  netFlowThisMonth: number;
  currencySymbol: string;
  currencyCode: string;
  transactionCount: number;
  periodLabel: string;
  categoryBreakdown: { [category: string]: number };
  transactions: Transaction[];
}

// Helper to decode Base64 / Base64URL string from Gmail API
export function decodeBase64(str: string): string {
  try {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch (e) {
    return str;
  }
}

// Regex patterns for financial amounts
const AMOUNT_REGEXES = [
  /(?:Rs\.?|INR|₹|\$|USD|EUR|GBP|CAD|AUD)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹|USD|\$|EUR|GBP)/i,
  /(?:amount|amt|spent|debited|credited|paid|received|charged)\s*(?:of)?\s*(?:Rs\.?|INR|₹|\$|USD|EUR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
];

// Regex for debit vs credit detection
const DEBIT_KEYWORDS = [
  "debited", "spent", "paid", "charged", "sent", "deducted", "withdrawn",
  "debit", "purchase", "txn", "paid to", "payment for", "transferred to"
];

const CREDIT_KEYWORDS = [
  "credited", "received", "deposited", "refunded", "added", "salary",
  "credit", "received from", "cashback"
];

/**
 * Extract financial transaction details from email subject & body
 */
export function parseFinancialEmail(
  emailId: string,
  subject: string,
  sender: string,
  dateStr: string,
  snippet: string,
  bodyText: string
): Transaction | null {
  const fullContent = `${subject} ${snippet} ${bodyText}`.replace(/\s+/g, " ");

  // Check if email looks like a financial notification
  const isFinancial =
    /debited|credited|spent|paid|received|transaction|txn|vpa|bank|a\/c|card|charge|statement|alert|debit|credit|purchase/i.test(
      fullContent
    );

  if (!isFinancial) return null;

  // 1. Extract Amount
  let amount = 0;
  let currencySymbol = "₹";
  let currencyCode = "INR";

  for (const regex of AMOUNT_REGEXES) {
    const match = fullContent.match(regex);
    if (match && match[1]) {
      const cleanedAmount = match[1].replace(/,/g, "");
      const parsedNum = parseFloat(cleanedAmount);
      if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 10000000) {
        amount = parsedNum;
        
        // Detect currency symbol
        if (fullContent.includes("$") || /USD/i.test(fullContent)) {
          currencySymbol = "$";
          currencyCode = "USD";
        } else if (fullContent.includes("€") || /EUR/i.test(fullContent)) {
          currencySymbol = "€";
          currencyCode = "EUR";
        } else if (fullContent.includes("£") || /GBP/i.test(fullContent)) {
          currencySymbol = "£";
          currencyCode = "GBP";
        }
        break;
      }
    }
  }

  // If no valid amount found, skip non-transaction emails
  if (amount === 0) return null;

  // 2. Determine Transaction Type (Debit/Spent vs Credit/Received)
  let type: "debit" | "credit" = "debit";
  const lowerContent = fullContent.toLowerCase();
  
  let creditScore = 0;
  let debitScore = 0;

  CREDIT_KEYWORDS.forEach((kw) => {
    if (lowerContent.includes(kw)) creditScore++;
  });
  DEBIT_KEYWORDS.forEach((kw) => {
    if (lowerContent.includes(kw)) debitScore++;
  });

  if (creditScore > debitScore) {
    type = "credit";
  }

  // 3. Extract Merchant / Recipient / Description
  let merchant = extractMerchant(subject, snippet, bodyText, sender);

  // 4. Extract Category based on merchant & text
  const category = categorizeTransaction(merchant, fullContent);

  // 5. Account Snippet (e.g. A/c xx1234)
  const accountMatch = fullContent.match(/(?:a\/c|account|card)\s*(?:no\.?|num|ending|xx|\*+)?\s*([a-z0-9\*]{4,8})/i);
  const accountSnippet = accountMatch ? accountMatch[1] : undefined;

  const dateObj = new Date(dateStr);
  const formattedDate = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : dateStr;

  return {
    id: `${emailId}-${amount}-${type}`,
    emailId,
    subject,
    sender,
    date: dateStr,
    formattedDate,
    amount,
    currency: currencySymbol,
    type,
    merchant,
    category,
    accountSnippet,
    rawSnippet: snippet || subject,
  };
}

/**
 * Extract merchant or entity from email headers/content
 */
function extractMerchant(
  subject: string,
  snippet: string,
  body: string,
  sender: string
): string {
  const content = `${subject} ${snippet}`;

  // Common patterns in Indian & Global Banking SMS/Emails
  const toMatch = content.match(/(?:paid to|info:|vpa|towards|spent at|to|at)\s+([A-Za-z0-9\s&\.\-_]{3,25})/i);
  if (toMatch && toMatch[1]) {
    const raw = toMatch[1].trim();
    if (!/account|bank|balance|ref|upi|txn/i.test(raw)) {
      return cleanMerchantName(raw);
    }
  }

  // Brand detection
  const KNOWN_BRANDS = [
    "Amazon", "Zomato", "Swiggy", "Uber", "Ola", "Flipkart", "Myntra", "Apple",
    "Netflix", "Spotify", "Google", "YouTube", "Swiggy Instamart", "Blinkit", "Zepto",
    "Starbucks", "McDonalds", "MakeMyTrip", "BookMyShow", "Paytm", "PhonePe", "GPay"
  ];

  for (const brand of KNOWN_BRANDS) {
    if (new RegExp(brand, "i").test(content) || new RegExp(brand, "i").test(sender)) {
      return brand;
    }
  }

  // Fallback to sender name or cleaned subject
  if (sender) {
    const cleanSender = sender.replace(/<.*?>/g, "").replace(/["']/g, "").trim();
    if (cleanSender && !cleanSender.toLowerCase().includes("no-reply")) {
      return cleanSender;
    }
  }

  return "General Merchant";
}

function cleanMerchantName(name: string): string {
  return name
    .replace(/on\s+\d{2}\/\d{2}.*/i, "")
    .replace(/via\s+.*/i, "")
    .replace(/ref\s+.*/i, "")
    .trim();
}

/**
 * Categorize transaction
 */
function categorizeTransaction(merchant: string, text: string): string {
  const combined = `${merchant} ${text}`.toLowerCase();

  if (/zomato|swiggy|food|restaurant|cafe|coffee|starbucks|dining|eats|pizza|burger|mcdonald/i.test(combined)) {
    return "Food & Dining";
  }
  if (/amazon|flipkart|myntra|shopping|store|apparel|nike|cloth|mall|retail/i.test(combined)) {
    return "Shopping & E-Commerce";
  }
  if (/uber|ola|lyft|cab|taxi|flight|airline|train|irctc|metro|petrol|fuel|gas/i.test(combined)) {
    return "Travel & Transport";
  }
  if (/netflix|spotify|youtube|apple|prime|hbo|disney|entertainment|movie|cinema|game/i.test(combined)) {
    return "Subscriptions & Media";
  }
  if (/electricity|water|wifi|broadband|recharge|mobile|bill|airtel|jio|vi/i.test(combined)) {
    return "Bills & Utilities";
  }
  if (/atm|withdrawal|cash|transfer|upi|bank|salary|rent/i.test(combined)) {
    return "Transfers & Banking";
  }

  return "Other Expenses";
}

export interface MonthlySummary {
  monthKey: string; // e.g., "2026-09"
  periodLabel: string; // e.g., "September 2026"
  totalSpent: number;
  totalReceived: number;
  netFlow: number;
  transactionCount: number;
  categoryBreakdown: { [category: string]: number };
  transactions: Transaction[];
}

export interface FinancialData {
  currencySymbol: string;
  currencyCode: string;
  monthlySummaries: MonthlySummary[];
  allTransactions: Transaction[];
}

/**
 * Group and calculate financial summaries for all months
 */
export function calculateFinancialData(transactions: Transaction[]): FinancialData {
  if (transactions.length === 0) {
    return {
      currencySymbol: "₹",
      currencyCode: "INR",
      monthlySummaries: [],
      allTransactions: [],
    };
  }

  const currencySymbol = transactions[0]?.currency || "₹";
  const currencyCode = currencySymbol === "$" ? "USD" : "INR";

  const monthlyGroups: { [monthKey: string]: MonthlySummary } = {};

  transactions.forEach((t) => {
    const d = new Date(t.date);
    if (isNaN(d.getTime())) return;
    
    // Format as YYYY-MM
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    const periodLabel = d.toLocaleString("default", { month: "long", year: "numeric" });

    if (!monthlyGroups[monthKey]) {
      monthlyGroups[monthKey] = {
        monthKey,
        periodLabel,
        totalSpent: 0,
        totalReceived: 0,
        netFlow: 0,
        transactionCount: 0,
        categoryBreakdown: {},
        transactions: [],
      };
    }

    const group = monthlyGroups[monthKey];
    group.transactions.push(t);
    group.transactionCount++;

    if (t.type === "debit") {
      group.totalSpent += t.amount;
      group.categoryBreakdown[t.category] = (group.categoryBreakdown[t.category] || 0) + t.amount;
    } else {
      group.totalReceived += t.amount;
    }
  });

  // Finalize totals and sort months descending
  const monthlySummaries = Object.values(monthlyGroups).map(group => {
    group.totalSpent = Math.round(group.totalSpent * 100) / 100;
    group.totalReceived = Math.round(group.totalReceived * 100) / 100;
    group.netFlow = Math.round((group.totalReceived - group.totalSpent) * 100) / 100;
    // Sort transactions within month descending
    group.transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return group;
  });

  monthlySummaries.sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  return {
    currencySymbol,
    currencyCode,
    monthlySummaries,
    allTransactions: transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  };
}
