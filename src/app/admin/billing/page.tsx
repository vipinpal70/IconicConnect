/**
 * src/app/admin/billing/page.tsx
 * Purpose: Admin Billing UI with client filters, date ranges, API-backed invoice generation, and a professional editable invoice form.
 * Authors: Antigravity AI
 */

"use client"

import { useState, useEffect } from "react";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Download, Clock, AlertTriangle, CheckCircle, FileText, Receipt, ChevronDown, Users, ArrowLeft, Printer, Save } from "lucide-react";
import { toast } from "sonner";

interface InvoiceOverview {
  id: string;
  clientId: string;
  client: string;
  month: string;
  caseCount: number;
  amount: number;
  status: string;
}

interface ClientProfile {
  id: string;
  fullName: string | null;
  labName: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

interface DetailedInvoiceCase {
  id: string;
  caseNumber: string | null;
  category: string | null;
  subTypeData: any;
  status: string;
  createdAt: string;
  dueDate: string | null;
  price: number;
  // UI-local custom description
  description?: string;
}

interface GeneratedInvoice {
  client: {
    id: string;
    fullName: string | null;
    labName: string | null;
    email: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  cases: DetailedInvoiceCase[];
  totalPrice: number;
  startDate?: string;
  endDate?: string;
  invoiceNumber?: string;
}

const statusColor: Record<string, string> = {
  Paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  Overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceOverview[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientProfile | { id: "all"; labName: "All Clients"; fullName: "All Clients" }>({ id: "all", labName: "All Clients", fullName: "All Clients" });

  const [generatedInvoice, setGeneratedInvoice] = useState<GeneratedInvoice | null>(null);

  // Candidate Cases for Selection
  const [candidateCases, setCandidateCases] = useState<DetailedInvoiceCase[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [isFetchingCases, setIsFetchingCases] = useState(false);
  const [rawFetchedData, setRawFetchedData] = useState<any | null>(null);

  // Toggle selection for a single case
  const handleToggleCase = (caseId: string) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) {
        next.delete(caseId);
      } else {
        next.add(caseId);
      }
      return next;
    });
  };

  // Toggle "Select All"
  const handleToggleSelectAll = () => {
    if (selectedCaseIds.size === candidateCases.length) {
      setSelectedCaseIds(new Set());
    } else {
      setSelectedCaseIds(new Set(candidateCases.map((c) => c.id)));
    }
  };

  // Change selected client and clear all current billing/dates data
  const handleSelectClient = (client: any) => {
    setSelectedClient(client);
    setStartDate("");
    setEndDate("");
    setCandidateCases([]);
    setSelectedCaseIds(new Set());
    setRawFetchedData(null);
  };

  // Automated fetching of eligible cases when client or dates change
  useEffect(() => {
    async function fetchCases() {
      if (!startDate || !endDate) {
        setCandidateCases([]);
        setSelectedCaseIds(new Set());
        setRawFetchedData(null);
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        return;
      }

      setIsFetchingCases(true);
      try {
        const url = `/api/billing/clients/${selectedClient.id}?startDate=${startDate}&endDate=${endDate}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error("Failed to fetch cases");
        }
        const data = await res.json();
        setRawFetchedData(data);

        // Filter for approved and delivered status only
        const eligible = (data.cases || []).filter(
          (c: DetailedInvoiceCase) => c.status === "approved" || c.status === "delivered"
        );

        setCandidateCases(eligible);
        setSelectedCaseIds(new Set(eligible.map((c: DetailedInvoiceCase) => c.id)));
      } catch (err) {
        console.error("Error fetching cases:", err);
        toast.error("Failed to load eligible cases for selection.");
      } finally {
        setIsFetchingCases(false);
      }
    }

    fetchCases();
  }, [selectedClient.id, startDate, endDate]);

  // Editable Form States
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [billingPeriod, setBillingPeriod] = useState("");
  const [fromName, setFromName] = useState("Iconic Connect Dental Lab");
  const [fromAddress, setFromAddress] = useState("100 Aesthetic Way, Suite 400\nNew York, NY 10001\nsupport@iconicconnect.com");
  const [clientLabName, setClientLabName] = useState("");
  const [clientContactName, setClientContactName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");

  const [invoiceCases, setInvoiceCases] = useState<DetailedInvoiceCase[]>([]);
  const [invoiceTotalPrice, setInvoiceTotalPrice] = useState(0);

  // Load Invoices and Clients on mount
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [invoicesRes, clientsRes] = await Promise.all([
          fetch("/api/billing"),
          fetch("/api/admin/clients")
        ]);

        if (invoicesRes.ok) {
          const invoicesData = await invoicesRes.json();
          setInvoices(invoicesData);
        } else {
          console.error("Failed to fetch invoices");
        }

        if (clientsRes.ok) {
          const clientsData = await clientsRes.json();
          setClients(clientsData);
        } else {
          console.error("Failed to fetch clients");
        }
      } catch (err) {
        console.error("Error loading billing data:", err);
        toast.error("Failed to load billing information.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Filter invoices for display
  const filteredInvoices = selectedClient.id === "all"
    ? invoices
    : invoices.filter((i) => i.clientId === selectedClient.id);

  // Maps case properties to detailed description on invoice
  const getCaseDetailsLabel = (caseItem: DetailedInvoiceCase) => {
    const data = caseItem.subTypeData || {};
    if (data._customDescription) return data._customDescription;

    const category = caseItem.category;
    if (!category) return "—";

    const normalized = category.toLowerCase().trim();
    if (normalized === "crown & bridge" || normalized === "crown & bridges") {
      return `Crown & Bridge: ${data.sub_category || data.subCategory || data.caseType || "Crown"}`;
    }
    if (normalized === "implant" || normalized === "implants") {
      const subCat = data.sub_category || data.subCategory || data.caseType1 || "Ti-Base";
      const type = data.type || data.caseType2 || "None";
      if (!type || type.toLowerCase() === "none") {
        return `Implant: ${subCat}`;
      }
      return `Implant: ${subCat} (${type})`;
    }
    if (normalized === "appliances" || normalized === "appliance") {
      const appType = data.appliance_type || data.applianceType || data.caseType1 || "Night Guards";
      const occlusion = data.occlusion_type || data.occlusionType || data.occlusion ? ` - ${data.occlusion_type || data.occlusionType || data.occlusion}` : "";
      const arch = data.arch || data.caseType2 ? ` (${data.arch || data.caseType2})` : "";
      return `Appliance: ${appType}${occlusion}${arch}`;
    }
    if (normalized === "denture" || normalized === "dentures") {
      const subCat = data.sub_category || data.subCategory || data.caseType1 || "Full Denture";
      const arch = data.arch || data.caseType2 ? ` (${data.arch || data.caseType2})` : "";
      return `Denture: ${subCat}${arch}`;
    }
    if (normalized === "cosmetics" || normalized === "cosmetic") {
      const subCat = data.sub_category || data.subCategory || data.caseType1 || "Veneers";
      const arch = data.arch || data.caseType2 ? ` (${data.arch || data.caseType2})` : "";
      return `Cosmetic: ${subCat}${arch}`;
    }
    return category;
  };

  // Initialize editable form fields when an invoice is generated/retrieved
  const initializeInvoiceForm = (invoiceData: any, invId: string, start: string, end: string) => {
    const labName = invoiceData.client.labName || invoiceData.client.fullName || "All Clients";
    const addressString = [
      invoiceData.client.city,
      invoiceData.client.state,
      invoiceData.client.postalCode,
      invoiceData.client.country
    ].filter(Boolean).join(", ");

    setInvoiceNumber(invId);
    setInvoiceDate(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
    setBillingPeriod(`${start} to ${end}`);

    setClientLabName(labName);
    setClientContactName(invoiceData.client.fullName || "");
    setClientEmail(invoiceData.client.email || "");
    setClientPhone(invoiceData.client.phone || "");
    setClientAddress(addressString || "No address on file");

    const casesWithDetails = invoiceData.cases.map((c: any) => ({
      ...c,
      description: getCaseDetailsLabel(c)
    }));
    setInvoiceCases(casesWithDetails);
    setInvoiceTotalPrice(invoiceData.totalPrice);

    setGeneratedInvoice(invoiceData);
  };

  // Get Invoice Action (filters case lists strictly to user selected cases)
  const handleGetInvoice = () => {
    if (!rawFetchedData) {
      toast.error("No case data loaded.");
      return;
    }
    if (selectedCaseIds.size === 0) {
      toast.error("Please select at least one case to bill.");
      return;
    }

    setIsGenerating(true);
    try {
      // Filter cases strictly to the selected ones
      const selectedCases = rawFetchedData.cases.filter((c: DetailedInvoiceCase) =>
        selectedCaseIds.has(c.id)
      );

      // Recalculate total price for selected cases
      const totalPrice = selectedCases.reduce((sum: number, c: DetailedInvoiceCase) => sum + c.price, 0);

      const filteredInvoiceData = {
        ...rawFetchedData,
        cases: selectedCases,
        totalPrice
      };

      const tempInvId = `INV-${Date.now().toString().slice(-6)}`;
      initializeInvoiceForm(filteredInvoiceData, tempInvId, startDate, endDate);

      toast.success("Invoice template loaded into editor");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate invoice. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // View summary of an existing invoice from the list
  const handleViewInvoiceSummary = async (invoice: InvoiceOverview) => {
    try {
      setLoading(true);
      // Parse the month e.g., "May 2026" to get start and end dates
      const [monthName, yearStr] = invoice.month.split(" ");
      const parsedMonth = new Date(`${monthName} 1, ${yearStr}`);
      const start = new Date(parsedMonth.getFullYear(), parsedMonth.getMonth(), 1).toISOString().split("T")[0];
      const end = new Date(parsedMonth.getFullYear(), parsedMonth.getMonth() + 1, 0).toISOString().split("T")[0];

      const res = await fetch(`/api/billing/clients/${invoice.clientId}?startDate=${start}&endDate=${end}`);
      if (!res.ok) {
        throw new Error("Failed to fetch detailed summary");
      }

      const data = await res.json();
      initializeInvoiceForm(data, invoice.id, start, end);
    } catch (err) {
      console.error(err);
      toast.error("Failed to retrieve invoice details");
    } finally {
      setLoading(false);
    }
  };

  // Handle local edits inside case rows
  const handleCasePriceChange = (index: number, value: string) => {
    const numeric = parseFloat(value) || 0;
    const updated = [...invoiceCases];
    updated[index] = {
      ...updated[index],
      price: numeric
    };
    setInvoiceCases(updated);

    // Recalculate totalPrice
    const newTotal = updated.reduce((sum, c) => sum + c.price, 0);
    setInvoiceTotalPrice(newTotal);
  };

  const handleCaseDescriptionChange = (index: number, value: string) => {
    const updated = [...invoiceCases];
    updated[index] = {
      ...updated[index],
      description: value
    };
    setInvoiceCases(updated);
  };

  // Save Invoice changes in-memory back to the main list
  const handleSaveInvoice = () => {
    toast.success(`Invoice ${invoiceNumber} saved successfully`);

    // Update local overview invoices state in-memory
    const exists = invoices.some(inv => inv.id === invoiceNumber);

    if (exists) {
      const updated = invoices.map(inv => {
        if (inv.id === invoiceNumber) {
          return {
            ...inv,
            amount: invoiceTotalPrice,
            caseCount: invoiceCases.length
          };
        }
        return inv;
      });
      setInvoices(updated);
    } else {
      // Append a new dynamic invoice
      const newInvoice: InvoiceOverview = {
        id: invoiceNumber,
        clientId: generatedInvoice?.client.id || "unknown",
        client: clientLabName || "Custom Invoice",
        month: new Date(invoiceDate).toLocaleString("en-US", { month: "long", year: "numeric" }),
        caseCount: invoiceCases.length,
        amount: invoiceTotalPrice,
        status: "Pending"
      };
      setInvoices([newInvoice, ...invoices]);
    }

    setGeneratedInvoice(null);
  };

  // Render Printable & Editable Invoice View
  if (generatedInvoice) {
    return (
      <AdminLayout>
        <div className="space-y-4 max-w-4xl mx-auto print:p-0">

          {/* Action buttons (hidden in print) */}
          <div className="flex justify-between items-center print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGeneratedInvoice(null)}
              className="h-8 text-xs gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Billing
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveInvoice}
                className="h-8 text-xs gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </Button>
              <Button
                size="sm"
                onClick={() => window.print()}
                className="h-8 text-xs gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" />
                Print / Download PDF
              </Button>
            </div>
          </div>

          {/* Standard Printable & Editable Invoice Form */}
          <Card id="printable-invoice-area" className="border-border/50 shadow-card bg-white text-gray-900 dark:bg-white dark:text-gray-900">
            <CardContent className="p-8 space-y-6">

              {/* Header */}
              <div className="flex justify-between items-start border-b border-gray-200 pb-6">
                <div>
                  <input
                    type="text"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    className="text-2xl font-bold tracking-tight text-primary bg-transparent focus:outline-none border-b border-transparent hover:border-gray-300 focus:border-primary w-80 print:border-none print:p-0"
                  />
                  <p className="text-xs text-gray-500 mt-1">Dental Lab Management Portal</p>
                  <textarea
                    rows={2}
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                    className="text-xs text-gray-500 bg-transparent focus:outline-none border-b border-transparent hover:border-gray-300 focus:border-primary w-80 resize-none print:border-none print:p-0 mt-1"
                  />
                </div>
                <div className="text-right">
                  <h3 className="text-xl font-bold uppercase text-gray-700">Invoice</h3>
                  <div className="text-xs text-gray-500 mt-2 space-y-1.5">
                    <div className="flex justify-end items-center gap-1.5">
                      <span className="font-semibold text-gray-700">Invoice Number:</span>
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none text-right w-28 bg-transparent print:border-none print:p-0"
                      />
                    </div>
                    <div className="flex justify-end items-center gap-1.5">
                      <span className="font-semibold text-gray-700">Date Issued:</span>
                      <input
                        type="text"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none text-right w-36 bg-transparent print:border-none print:p-0"
                      />
                    </div>
                    <div className="flex justify-end items-center gap-1.5">
                      <span className="font-semibold text-gray-700">Billing Period:</span>
                      <input
                        type="text"
                        value={billingPeriod}
                        onChange={(e) => setBillingPeriod(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none text-right w-44 bg-transparent print:border-none print:p-0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Addresses */}
              <div className="grid grid-cols-2 gap-8 text-xs">
                <div>
                  <p className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">Invoice From:</p>
                  <div className="mt-1.5 text-gray-600 space-y-0.5">
                    <p className="font-semibold text-gray-800">{fromName}</p>
                    <p className="whitespace-pre-wrap">{fromAddress}</p>
                  </div>
                </div>
                <div>
                  <p className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">Invoice To (Client):</p>
                  <div className="mt-1.5 text-gray-600 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={clientLabName}
                        onChange={(e) => setClientLabName(e.target.value)}
                        className="font-semibold text-gray-800 border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full print:border-none print:p-0"
                        placeholder="Client Lab Name"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={clientContactName}
                        onChange={(e) => setClientContactName(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full print:border-none print:p-0"
                        placeholder="Contact Name"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full print:border-none print:p-0"
                        placeholder="Email Address"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full print:border-none print:p-0"
                        placeholder="Phone Number"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <textarea
                        rows={2}
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full resize-none print:border-none print:p-0"
                        placeholder="Location details"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-2.5">Case Number</th>
                      <th className="px-4 py-2.5">Category</th>
                      <th className="px-4 py-2.5">Service Description (Editable)</th>
                      <th className="px-4 py-2.5">Date Created</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right w-24">Cost ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-gray-600">
                    {invoiceCases.map((caseItem, idx) => (
                      <tr key={caseItem.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{caseItem.caseNumber || caseItem.id.slice(0, 8)}</td>
                        <td className="px-4 py-2.5">{caseItem.category || "—"}</td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            value={caseItem.description || ""}
                            onChange={(e) => handleCaseDescriptionChange(idx, e.target.value)}
                            className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none bg-transparent w-full print:border-none print:p-0"
                          />
                        </td>
                        <td className="px-4 py-2.5">{new Date(caseItem.createdAt).toLocaleDateString("en-US")}</td>
                        <td className="px-4 py-2.5 capitalize">{caseItem.status.replace("_", " ")}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          <input
                            type="number"
                            step="0.01"
                            value={caseItem.price}
                            onChange={(e) => handleCasePriceChange(idx, e.target.value)}
                            className="border-b border-dashed border-gray-300 focus:border-solid focus:border-primary focus:outline-none text-right w-20 bg-transparent print:border-none print:p-0 font-medium text-gray-900"
                          />
                        </td>
                      </tr>
                    ))}
                    {invoiceCases.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                          No cases found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Grand Total */}
              <div className="flex justify-end pt-4 border-t border-gray-200">
                <div className="w-64 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal:</span>
                    <span>${invoiceTotalPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Taxes & Fees (0%):</span>
                    <span>$0.00</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1.5 text-sm font-bold text-gray-900">
                    <span>Total Price:</span>
                    <span>${invoiceTotalPrice.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  // Calculate Lifetime Summary Cards
  const totalAmount = filteredInvoices.reduce((s, i) => s + i.amount, 0);
  const paidCount = filteredInvoices.filter((i) => i.status === "Paid").length;
  const pendingCount = filteredInvoices.filter((i) => i.status === "Pending").length;
  const overdueCount = filteredInvoices.filter((i) => i.status === "Overdue").length;

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Billing & Invoices</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly case summaries and auto-generated invoices</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 text-xs px-3 shrink-0 gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {selectedClient.labName || selectedClient.fullName}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => handleSelectClient({ id: "all", labName: "All Clients", fullName: "All Clients" })}
              >
                All Clients
              </DropdownMenuItem>
              {clients.map((client) => (
                <DropdownMenuItem
                  key={client.id}
                  className="text-xs"
                  onSelect={() => handleSelectClient(client)}
                >
                  {client.labName || client.fullName || client.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(n => (
              <Card key={n} className="shadow-card border-border/50 animate-pulse">
                <CardContent className="p-3.5 h-16" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="shadow-card border-border/50">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {selectedClient.id === "all" ? "Total Revenue" : `${selectedClient.labName || selectedClient.fullName} Spend`}
                </p>
                <p className="text-xl font-semibold text-foreground mt-0.5">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardContent className="p-3.5 flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <CheckCircle className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Paid</p>
                  <p className="text-lg font-semibold text-foreground">{paidCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardContent className="p-3.5 flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pending</p>
                  <p className="text-lg font-semibold text-foreground">{pendingCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardContent className="p-3.5 flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Overdue</p>
                  <p className="text-lg font-semibold text-foreground">{overdueCount}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Generate Bill Form */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generate Bill</CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Select a date range to generate a detailed invoice for {selectedClient.labName || selectedClient.fullName}
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Select Cases to Invoice Card */}
        {startDate && endDate && (
          <Card className="shadow-card border-border/50 animate-fade-in">
            <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select Cases to Invoice
                </CardTitle>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Select the approved or delivered cases to be added to the invoice
                </p>
              </div>
              {candidateCases.length > 0 && (
                <div className="text-[11px] font-medium text-muted-foreground">
                  {selectedCaseIds.size} of {candidateCases.length} cases selected
                </div>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isFetchingCases ? (
                <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Loading eligible cases...
                </div>
              ) : candidateCases.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No approved or delivered cases found for {selectedClient.labName || selectedClient.fullName} in this period.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border border-border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border text-muted-foreground font-semibold uppercase tracking-wider text-[9px]">
                          <th className="p-3 w-10 text-center">
                            <input
                              type="checkbox"
                              checked={selectedCaseIds.size === candidateCases.length}
                              onChange={handleToggleSelectAll}
                              className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                            />
                          </th>
                          <th className="p-3">Case Number</th>
                          <th className="p-3">Description</th>
                          <th className="p-3">Date Created</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-foreground">
                        {candidateCases.map((c) => (
                          <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={selectedCaseIds.has(c.id)}
                                onChange={() => handleToggleCase(c.id)}
                                className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="p-3 font-medium">{c.caseNumber || c.id.slice(0, 8)}</td>
                            <td className="p-3">{getCaseDetailsLabel(c)}</td>
                            <td className="p-3">{new Date(c.createdAt).toLocaleDateString()}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold scale-95 origin-left inline-flex capitalize ${c.status === "delivered"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                }`}>
                                {c.status.replace("_", " ")}
                              </span>
                            </td>
                            <td className="p-3 text-right font-medium">${c.price.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-border">
                    <div className="text-[11px] text-muted-foreground font-medium">
                      Selected Total: <span className="font-semibold text-foreground">${candidateCases
                        .filter(c => selectedCaseIds.has(c.id))
                        .reduce((sum, c) => sum + c.price, 0)
                        .toFixed(2)}</span>
                    </div>
                    <Button
                      onClick={handleGetInvoice}
                      disabled={isGenerating || selectedCaseIds.size === 0}
                      className="h-8 text-xs px-4"
                    >
                      <Receipt className="h-3.5 w-3.5 mr-1.5" />
                      {isGenerating ? "Getting..." : "Get Invoice"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invoices List */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice", "Client", "Period", "Cases", "Amount", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-3.5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    [1, 2, 3].map(n => (
                      <tr key={n}>
                        <td colSpan={7} className="px-3.5 py-4 text-center text-xs text-muted-foreground">Loading billing records...</td>
                      </tr>
                    ))
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-3.5 py-2 text-[11px] font-semibold text-primary">{inv.id}</td>
                        <td className="px-3.5 py-2 text-[11px] text-foreground">{inv.client}</td>
                        <td className="px-3.5 py-2 text-[11px] text-foreground">{inv.month}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{inv.caseCount}</td>
                        <td className="px-3.5 py-2 text-[11px] font-semibold text-foreground">${inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-3.5 py-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold scale-95 origin-left inline-flex ${statusColor[inv.status] || "bg-gray-100"}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 flex gap-1 justify-end items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="View summary"
                            onClick={() => handleViewInvoiceSummary(inv)}
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                  {!loading && filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-6 text-center text-xs text-muted-foreground">
                        No billing summaries found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
