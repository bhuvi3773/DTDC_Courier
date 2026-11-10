'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  listTickets,
  getTicket,
  createTicket,
  replyTicket,
  listNotifications,
  listShipments,
  TicketSummaryDTO,
  TicketDetailDTO,
  NotificationDTO,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import {
  LifeBuoy,
  Bell,
  MessageSquare,
  Plus,
  Send,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export default function SupportPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const [tab, setTab] = useState<'tickets' | 'notifications'>('tickets');

  const [tickets, setTickets] = useState<TicketSummaryDTO[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetailDTO | null>(null);
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [shipments, setShipments] = useState<Array<{ id: string; awb: string; status: string }>>([]);

  // New Ticket Form
  const [awb, setAwb] = useState('');
  const [type, setType] = useState('DELAY');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [replyBody, setReplyBody] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!session.capabilities.canViewCustomerSupport) {
      setLoading(false);
      return;
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qAwb = params.get('awb');
      if (qAwb) setAwb(qAwb);
    }
    loadAll(session.token);
  }, [session.loading, session.token, session.capabilities.canViewCustomerSupport]);

  const loadAll = async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const [tks, notifs, ships] = await Promise.all([
        listTickets({}, t),
        listNotifications({}, t),
        listShipments({}, t).catch(() => []),
      ]);
      setTickets(tks);
      setNotifications(notifs);
      setShipments(ships);
      if (tks.length > 0 && !selectedTicket) {
        const detail = await getTicket(tks[0].id, t);
        setSelectedTicket(detail);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load support center');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTicket = async (id: string) => {
    if (!token) return;
    try {
      setSelectedTicket(await getTicket(id, token));
    } catch (err: any) {
      setError(err?.message || 'Unable to load ticket thread');
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    setBanner(null);
    try {
      const created = await createTicket(
        {
          awbOrShipmentId: awb.trim() || undefined,
          type,
          subject: subject.trim(),
          message: messageBody.trim(),
        },
        token,
      );
      setSubject('');
      setMessageBody('');
      setBanner('Support ticket created! Our ops team will respond shortly.');
      await loadAll(token);
      await handleOpenTicket(created.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedTicket || !replyBody.trim()) return;
    setError(null);
    try {
      await replyTicket(selectedTicket.id, replyBody.trim(), token);
      setReplyBody('');
      const refreshed = await getTicket(selectedTicket.id, token);
      setSelectedTicket(refreshed);
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to post reply');
    }
  };

  if (session.loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Checking session permissions...</div>;
  }
  if (!session.capabilities.canViewCustomerSupport) {
    return (
      <AccessRestricted
        roleLabel={session.capabilities.label}
        requiredLabel="Customers or Support Staff"
        fallbackHref={session.capabilities.defaultHome}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
            <LifeBuoy className="h-6 w-6 text-brand-600" />
            Support, Claims &amp; <span className="text-brand-600">Notifications</span>
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Raise shipment complaints or damage claims, chat with support, and review SMS/email updates.
          </p>
        </div>

        <button
          onClick={() => token && loadAll(token)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {banner && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner}</span>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setTab('tickets')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
            tab === 'tickets'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Support Tickets &amp; Claims ({tickets.length})
        </button>
        <button
          onClick={() => setTab('notifications')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
            tab === 'notifications'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Bell className="h-3.5 w-3.5" /> My Notifications ({notifications.length})
        </button>
      </div>

      {tab === 'tickets' ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Left 5 cols: Create Ticket + List */}
          <div className="space-y-6 lg:col-span-5">
            <form
              onSubmit={handleCreateTicket}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 text-xs"
            >
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Plus className="h-4 w-4 text-brand-600" /> Open Support Ticket / Claim
              </h2>

              <div>
                <label className="block font-medium text-slate-700">Shipment AWB (Optional)</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    placeholder="BC2611..."
                    value={awb}
                    onChange={(e) => setAwb(e.target.value.toUpperCase())}
                    className="flex-1 rounded border border-slate-300 px-3 py-1.5 font-mono uppercase"
                  />
                  {shipments.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => setAwb(e.target.value)}
                      className="max-w-[140px] rounded border border-slate-300 bg-slate-50 px-2 py-1.5"
                    >
                      <option value="">Select AWB</option>
                      {shipments.map((s) => (
                        <option key={s.id} value={s.awb}>
                          {s.awb}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700">Issue Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="DELAY">Delivery Delay</option>
                    <option value="DAMAGE">Damaged / Wet Books</option>
                    <option value="LOST">Missing / Lost</option>
                    <option value="WRONG_DELIVERY">Wrong Delivery</option>
                    <option value="BILLING">Billing / Refund</option>
                    <option value="COMPLAINT">General Complaint</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Subject</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    placeholder="Short summary"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Details</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  placeholder="Describe the issue clearly (note: damage claims apply within 7 days of delivery)..."
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </form>

            {/* Ticket list */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700">
                Your Tickets
              </div>
              {loading ? (
                <p className="p-4 text-xs text-slate-500">Loading tickets...</p>
              ) : tickets.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No support tickets raised yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleOpenTicket(t.id)}
                      className={`w-full p-3.5 text-left transition hover:bg-slate-50 ${
                        selectedTicket?.id === t.id ? 'bg-indigo-50/70' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-900 truncate">{t.subject}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            t.status === 'RESOLVED' || t.status === 'CLOSED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : t.status === 'IN_REVIEW'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t.type}
                        {t.shipment ? ` • ${t.shipment.awb}` : ''} &bull; {t.messageCount} msg(s)
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 7 cols: Selected Ticket Conversation */}
          <div className="lg:col-span-7">
            {selectedTicket ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col h-full">
                <div className="border-b border-slate-100 pb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {selectedTicket.type}
                    </span>
                    <h2 className="mt-1 text-base font-bold text-slate-900">{selectedTicket.subject}</h2>
                    {selectedTicket.shipment && (
                      <Link
                        href={`/track?awb=${selectedTicket.shipment.awb}`}
                        className="text-xs font-mono text-indigo-600 hover:underline"
                      >
                        Shipment {selectedTicket.shipment.awb} ({selectedTicket.shipment.status})
                      </Link>
                    )}
                  </div>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                    {selectedTicket.status}
                  </span>
                </div>

                <div className="my-4 space-y-3 flex-1 max-h-[380px] overflow-y-auto pr-1">
                  {selectedTicket.messages.map((m) => {
                    const isStaffMsg = m.authorRole !== 'CUSTOMER';
                    return (
                      <div
                        key={m.id}
                        className={`rounded-lg p-3 text-xs ${
                          isStaffMsg
                            ? 'bg-indigo-50 border border-indigo-100 ml-4'
                            : 'bg-slate-50 border border-slate-200 mr-4'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                          <span className="font-bold text-slate-800">
                            {m.authorName} ({m.authorRole})
                          </span>
                          <span>{new Date(m.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-800 whitespace-pre-wrap">{m.body}</p>
                      </div>
                    );
                  })}
                </div>

                {selectedTicket.status !== 'CLOSED' && (
                  <form onSubmit={handleReply} className="mt-auto flex gap-2 border-t border-slate-100 pt-3">
                    <input
                      type="text"
                      required
                      placeholder="Write a reply..."
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      <Send className="h-3.5 w-3.5" /> Reply
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-xs text-slate-500">
                Select a ticket on the left to inspect conversation history or post updates.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* My Notifications Feed */
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700">
            SMS &amp; Email Dispatch Feed
          </div>
          {notifications.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500">No shipment or ticket notifications logged yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <div key={n.id} className="p-4 flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold">
                        {n.channel}
                      </span>
                      <span className="font-semibold text-slate-900">{n.template.replace(/_/g, ' ')}</span>
                      <span className="text-slate-500">&rarr; {n.target}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{n.payload?.message ?? n.payload?.subject ?? ''}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        n.status === 'SENT'
                          ? 'bg-emerald-100 text-emerald-800'
                          : n.status === 'FAILED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {n.status}
                    </span>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

