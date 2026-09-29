import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { google } from "googleapis";
import { parseFinancialEmail, calculateFinancialData, decodeBase64, Transaction } from "@/lib/parser";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken || !session.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in with Google." },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;

    // Support custom timeframe via query parameter
    const { searchParams } = new URL(request.url);
    const months = searchParams.get("months") || "6";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let dateQuery = `newer_than:${months}m`;
    if (startDate && endDate) {
      // Gmail expects dates in YYYY/MM/DD format
      const start = new Date(startDate).toISOString().split('T')[0].replace(/-/g, '/');
      const end = new Date(endDate).toISOString().split('T')[0].replace(/-/g, '/');
      dateQuery = `after:${start} before:${end}`;
    }

    // 1. Fetch existing email IDs from the database to avoid re-fetching from Gmail
    const existingRecords = await db
      .select({ emailId: transactions.emailId })
      .from(transactions)
      .where(eq(transactions.userEmail, userEmail));
    
    const existingEmailIds = new Set(existingRecords.map((r) => r.emailId));

    // Initialize Google OAuth2 client with user's access token
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Construct Gmail search query to find financial transactions
    const query =
      `(debited OR credited OR spent OR transaction OR paid OR transferred OR bank OR upi OR card OR HDFC OR ICICI OR SBI OR Axis OR Kotak OR Paytm OR PhonePe OR GPay OR Apple OR Amazon OR Uber OR Zomato OR Swiggy) ${dateQuery}`;

    let messages: any[] = [];
    try {
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 100,
      });
      messages = listRes.data.messages || [];
    } catch (err: any) {
      console.error("Failed to list messages from Gmail", err?.message);
    }

    let newlyInserted = 0;

    // 2. Fetch individual email details ONLY for new emails
    for (const msg of messages) {
      if (!msg.id || existingEmailIds.has(msg.id)) continue;

      try {
        await new Promise((resolve) => setTimeout(resolve, 50)); // rate limiting

        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const payload = msgRes.data.payload;
        if (!payload) continue;

        const headers = payload.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const sender = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const dateStr = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";
        const snippet = msgRes.data.snippet || "";

        let bodyText = "";
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              bodyText += decodeBase64(part.body.data);
            }
          }
        } else if (payload.body?.data) {
          bodyText = decodeBase64(payload.body.data);
        }

        const parsed = parseFinancialEmail(
          msg.id,
          subject,
          sender,
          dateStr,
          snippet,
          bodyText
        );

        if (parsed) {
          // Insert into database
          await db.insert(transactions).values({
            emailId: msg.id,
            userEmail,
            subject: parsed.subject,
            sender: parsed.sender,
            date: new Date(parsed.date),
            amount: parsed.amount,
            currency: parsed.currency,
            type: parsed.type,
            merchant: parsed.merchant,
            category: parsed.category,
            accountSnippet: parsed.accountSnippet,
            rawSnippet: parsed.rawSnippet,
          }).onConflictDoNothing();
          
          newlyInserted++;
        }
      } catch (err: any) {
        console.error(`Error processing email ${msg.id}:`, err?.message || err);
        if (err?.code === 403 || err?.code === 429 || err?.message?.includes("Quota exceeded")) {
          console.warn("Gmail API Quota exceeded or rate limited. Stopping fetch early.");
          break;
        }
      }
    }

    // 3. Fetch all transactions for this user from the DB
    const allDbRecords = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userEmail, userEmail))
      .orderBy(desc(transactions.date));

    // Convert DB records back to UI format
    const uiTransactions: Transaction[] = allDbRecords.map((t) => ({
      id: t.emailId,
      date: t.date.toISOString(),
      formattedDate: t.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      amount: t.amount,
      currency: t.currency,
      type: t.type as "debit" | "credit",
      merchant: t.merchant || "Unknown",
      category: t.category || "Other Expenses",
      subject: t.subject || "",
      sender: t.sender || "",
      accountSnippet: t.accountSnippet || "",
      rawSnippet: t.rawSnippet || "",
    }));

    if (uiTransactions.length === 0) {
      return NextResponse.json({
        summaryMessage: "No financial transactions found in your database or mailbox.",
        financialData: calculateFinancialData([]),
      });
    }

    const financialData = calculateFinancialData(uiTransactions);
    
    let summaryMessage = "No transactions found.";
    if (financialData.monthlySummaries.length > 0) {
      const latestMonth = financialData.monthlySummaries[0];
      summaryMessage = `You spent ${financialData.currencySymbol}${latestMonth.totalSpent.toLocaleString()} in ${latestMonth.periodLabel}.`;
    }

    return NextResponse.json({
      summaryMessage,
      financialData,
      newlySynced: newlyInserted,
      totalRecords: uiTransactions.length
    });
  } catch (error: any) {
    console.error("Gmail Sync Error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch financial emails from Gmail API or DB.",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
