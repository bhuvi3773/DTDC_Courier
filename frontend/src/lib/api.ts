import { clearToken, getCachedSession, getRefreshToken, getToken, setToken } from './auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export function apiUrl(path: string): string {
  return `${API}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the stored refresh token for a fresh access + refresh pair using a
 * single-flight lock so concurrent 401s do not collide on one-time token rotation.
 */
async function refreshAccessToken(staleToken?: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const current = getToken();
  if (current && staleToken && current !== staleToken) {
    return current;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const rt = getRefreshToken();
    if (!rt) {
      if (staleToken) clearToken();
      return null;
    }

    try {
      const res = await fetch(apiUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
        cache: 'no-store',
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearToken();
        }
        return null;
      }

      const json = (await res.json().catch(() => null)) as {
        data?: { accessToken?: string; refreshToken?: string };
      } | null;
      const accessToken = json?.data?.accessToken;
      const refreshToken = json?.data?.refreshToken;
      if (!accessToken) return null;

      setToken(accessToken, getCachedSession() ?? undefined, refreshToken);
      return accessToken;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function fetchWithAuthRetry(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  const url = apiUrl(path);
  const doFetch = (authToken?: string) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  };

  let res = await doFetch(opts.token);
  if (res.status === 401 && opts.token && !path.startsWith('/auth/refresh')) {
    const refreshed = await refreshAccessToken(opts.token);
    if (refreshed) {
      res = await doFetch(refreshed);
      if (res.status === 401) {
        clearToken();
      }
    }
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetchWithAuthRetry(path, opts);

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      (json as { code?: string }).code ?? 'ERROR',
      (json as { message?: string }).message ?? `HTTP ${res.status}`,
    );
  }
  return (json as { data: T }).data;
}

// ---------- Domain types (mirrors the backend) ----------

export interface QuoteBreakdown {
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  base: number;
  pickupFee: number;
  packagingFee: number;
  protectionFee: number;
  codFee?: number;
  serviceSurcharge: number;
  contractDiscount?: number;
  promoDiscount?: number;
  appliedPromoCode?: string;
  promoMessage?: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  etaDays: number;
  slab: { originZone: string; destZone: string; serviceType: string; maxWeightKg: number };
}

export interface RoutingOption {
  optionId: string;
  legPlan: Array<{ carrierType: 'OWN' | 'PARTNER'; carrierCode: string; label: string }>;
  carrierCodes: string[];
  price: number;
  etaDays: number;
  carrierTypeLabel: string;
  breakdown?: QuoteBreakdown;
}

export interface QuoteResult {
  options: RoutingOption[];
  strategy: string;
  hasCorporateRate?: boolean;
}

export interface TimelineEntry {
  status?: string | null;
  exceptionCode?: string | null;
  locationLabel?: string | null;
  remarks?: string | null;
  eventTime: string;
}

export interface PublicShipment {
  awb: string;
  status: string;
  estimatedDeliveryAt?: string | null;
  serviceType: string;
  shipmentType?: string;
  destinationCountry?: string;
  paymentMethod?: string;
  codAmount?: number | null;
  carrier?: {
    carrierType: 'OWN' | 'PARTNER';
    carrierCode: string;
    carrierName: string;
    externalAwb?: string | null;
  } | null;
  origin?: { city: string; pincode: string } | null;
  recipient?: { firstName: string; city: string; pincode: string } | null;
  timeline: TimelineEntry[];
}

export interface ShipmentLeg {
  carrierType: 'OWN' | 'PARTNER';
  sequence: number;
  externalAwb?: string | null;
  status: string;
}

export interface CreatedShipment {
  shipment: {
    id: string;
    awb: string;
    status: string;
    legs: ShipmentLeg[];
    packages: Array<{ barcode: string }>;
  };
  paymentOrder: { amount: string; status: string };
}

export interface Carrier {
  id: string;
  code: string;
  name: string;
  type: 'OWN' | 'PARTNER';
  isEnabled: boolean;
}

export interface QuoteInput {
  fromPincode: string;
  toPincode: string;
  serviceType: string;
  packaging?: string;
  dims: { lengthCm: number; widthCm: number; heightCm: number; actualWeightKg: number };
  declaredValue?: number;
  protectionOpted?: boolean;
  paymentMethod?: 'PREPAID' | 'COD' | 'CORPORATE_CREDIT';
  promoCode?: string;
  destinationCountry?: string;
  fulfillmentMode?: 'OWN' | 'PARTNER' | 'AUTO';
  ownOnly?: boolean;
}

export interface AddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface NewShipment {
  optionId: string;
  shipmentType?: 'CUSTOMER_OWN_BOOK_SHIPMENT' | 'PARTNER_DIRECT_SHIPMENT';
  fulfillmentMode?: 'OWN' | 'PARTNER' | 'AUTO';
  serviceType: string;
  packaging: string;
  bookCount: number;
  parcelCount: number;
  declaredValue?: number;
  protectionOpted: boolean;
  paymentMethod?: 'PREPAID' | 'COD' | 'CORPORATE_CREDIT';
  promoCode?: string;
  destinationCountry?: string;
  ewayBillNumber?: string;
  prohibitedConfirmed?: boolean;
  solutionCategory?: string;
  goodsDescription?: string;
  specialInstructions?: string;
  fromPincode: string;
  toPincode: string;
  dims: QuoteInput['dims'];
  pickupSlotStart?: string;
  pickupSlotEnd?: string;
  pickupAddress: AddressInput;
  deliveryAddress: AddressInput;
  items?: Array<Record<string, unknown>>;
}

export interface GatewayOrder {
  provider: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  gateway: 'razorpay' | 'mock';
  keyId?: string;
  mockVerifyPayload?: { orderId: string; paymentId: string; signature: string };
}

export const createPaymentOrder = (shipmentId: string, token?: string) =>
  apiFetch<GatewayOrder>(`/payments/${shipmentId}/create-order`, { body: {}, token });

export type PaymentVerifyResult = {
  paid: boolean;
  transitioned: boolean;
  externalAwb?: string;
  awb: string;
  alreadyPaid: boolean;
};

export const verifyPayment = (
  shipmentId: string,
  proof: { orderId: string; paymentId: string; signature: string },
  token?: string,
) => apiFetch<PaymentVerifyResult>(`/payments/${shipmentId}/verify`, { body: proof, token });

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutInstance {
  open(): void;
  on(event: string, cb: (payload: { error?: { description?: string } }) => void): void;
}

interface RazorpayWindow extends Window {
  Razorpay?: new (opts: Record<string, unknown>) => RazorpayCheckoutInstance;
}

let razorpayScriptPromise: Promise<void> | null = null;

/** Dynamically load Razorpay Checkout JS once when live Razorpay mode is active. */
export function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout requires a browser environment'));
  }
  const win = window as RazorpayWindow;
  if (win.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScriptPromise = null;
      reject(new Error('Failed to load Razorpay checkout script'));
    };
    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

/**
 * Pay a shipment through the active gateway. In dev (mock gateway) the
 * create-order response carries a pre-signed payload; in production
 * (RAZORPAY_KEY_ID configured) it opens Razorpay's Checkout modal and submits
 * the signed callback payload to /api/payments/:id/verify.
 */
export async function payShipment(shipmentId: string, token?: string): Promise<PaymentVerifyResult> {
  const order = await createPaymentOrder(shipmentId, token);
  if (order.mockVerifyPayload) {
    return verifyPayment(shipmentId, order.mockVerifyPayload, token);
  }
  if (!order.keyId) {
    throw new Error('Razorpay Key ID missing from payment order response');
  }

  await loadRazorpayScript();
  const RazorpayCtor = (window as RazorpayWindow).Razorpay;
  if (!RazorpayCtor) {
    throw new Error('Razorpay checkout SDK unavailable after script load');
  }

  return new Promise<PaymentVerifyResult>((resolve, reject) => {
    let settled = false;
    const instance = new RazorpayCtor({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'BookCourier',
      description: 'Courier Service Payment',
      order_id: order.providerOrderId,
      handler: (response: RazorpayHandlerResponse) => {
        verifyPayment(
          shipmentId,
          {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          },
          token,
        )
          .then((verified) => {
            settled = true;
            resolve(verified);
          })
          .catch((err) => {
            settled = true;
            reject(err);
          });
      },
      modal: {
        ondismiss: () => {
          if (!settled) {
            settled = true;
            reject(new Error('Payment cancelled before completion'));
          }
        },
      },
    });

    instance.on('payment.failed', (evt) => {
      if (!settled) {
        settled = true;
        reject(new Error(evt?.error?.description ?? 'Payment failed at gateway'));
      }
    });

    instance.open();
  });
}

export const confirmPayment = (shipmentId: string, token?: string) =>
  apiFetch<{ alreadyPaid: boolean; externalAwb?: string; awb: string }>(`/payments/${shipmentId}/confirm`, {
    body: {},
    token,
  });

// ---------- High-level helpers ----------

export const quote = (body: QuoteInput, token?: string) =>
  apiFetch<QuoteResult>('/pricing/quote', { body, token });

export const createShipment = (body: NewShipment, token?: string) =>
  apiFetch<CreatedShipment>('/shipments', { body, token });

export const trackPublic = (awb: string) => apiFetch<PublicShipment>(`/track/${awb}`);

export const listShipments = (
  params: { status?: string; shipmentType?: string; page?: number } = {},
  token?: string,
) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.shipmentType) q.set('shipmentType', params.shipmentType);
  if (params.page) q.set('page', String(params.page));
  return apiFetch<
    Array<{
      id: string;
      awb: string;
      shipmentType: string;
      serviceType: string;
      status: string;
      paymentStatus: string;
      bookCount: number;
      createdAt: string;
    }>
  >(`/shipments?${q.toString()}`, { token });
};

export const postShipmentEvent = (
  shipmentId: string,
  event: { status?: string; kind?: string; remarks?: string; locationLabel?: string },
  token: string,
) =>
  apiFetch<{ applied: boolean; event: any; deliveryOtp?: { issued: boolean; code?: string } }>(
    `/admin/shipments/${shipmentId}/events`,
    {
      body: event,
      token,
    },
  );

export interface AuthLoginResult {
  accessToken: string;
  refreshToken: string;
  role: string;
  user?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    isEmailVerified?: boolean;
  };
}

export const requestOtp = (target: string) =>
  apiFetch<{ delivered: boolean; devCode?: string }>('/auth/request-otp', {
    body: { target, purpose: 'LOGIN' },
  });

export const verifyOtp = (target: string, code: string) =>
  apiFetch<AuthLoginResult>('/auth/verify-otp', {
    body: { target, code },
  });

export const staffLogin = (email: string, password: string) =>
  apiFetch<AuthLoginResult>('/auth/login', {
    body: { email, password },
  });

export const sendEmailOtp = (email: string, purpose: 'LOGIN_EMAIL' | 'PASSWORD_RESET' = 'LOGIN_EMAIL') =>
  apiFetch<{ sent: boolean; email: string; devCode?: string }>('/auth/email-otp/send', {
    body: { email, purpose },
  });

export const verifyEmailOtp = (email: string, code: string) =>
  apiFetch<AuthLoginResult>('/auth/email-otp/verify', {
    body: { email, code },
  });

export const sendSignupOtp = (body: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword?: string;
}) =>
  apiFetch<{ sent: boolean; email: string; devCode?: string }>('/auth/register/send-otp', {
    body,
  });

export const verifySignupOtp = (body: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  code: string;
}) =>
  apiFetch<AuthLoginResult>('/auth/register/verify', {
    body,
  });

export const forgotPasswordApi = (email: string) =>
  apiFetch<{ sent: boolean; message: string; devCode?: string }>('/auth/forgot-password', {
    body: { email },
  });

export const resetPasswordApi = (body: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword?: string;
}) =>
  apiFetch<{ reset: boolean }>('/auth/reset-password', {
    body,
  });

export const logoutSession = (refreshToken?: string) =>
  apiFetch<{ loggedOut: boolean }>('/auth/logout', {
    body: { refreshToken },
  });

export interface AuthMeResponse {
  user: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    isEmailVerified?: boolean;
  };
  role: string;
  permissions: string[];
}

export const getMe = (token: string) => apiFetch<AuthMeResponse>('/auth/me', { token });

export interface StaffUserDTO {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  hasPassword: boolean;
  role: string;
  agentCity?: string | null;
  createdAt: string;
}

export const listStaffUsers = (token: string) => apiFetch<StaffUserDTO[]>('/admin/users', { token });

export const createStaffUser = (
  body: {
    name: string;
    email: string;
    phone?: string;
    password: string;
    role: string;
    cityId?: string;
  },
  token: string,
) => apiFetch<StaffUserDTO>('/admin/users', { body, token });

export const setUserActiveStatus = (id: string, isActive: boolean, token: string) =>
  apiFetch<{ id: string; isActive: boolean }>(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body: { isActive },
    token,
  });

export const listCarriers = (token: string) => apiFetch<Carrier[]>('/admin/carriers', { token });

export const toggleCarrier = (id: string, isEnabled: boolean, token: string) =>
  apiFetch<{ id: string; code: string; isEnabled: boolean }>(`/admin/carriers/${id}/toggle`, {
    method: 'PATCH',
    body: { isEnabled },
    token,
  });

export const setRoutingStrategy = (strategy: string, token: string) =>
  apiFetch<{ strategy: string }>('/admin/settings/routing-strategy', {
    method: 'PATCH',
    body: { strategy },
    token,
  });

export const getCurrentStrategy = (token: string) =>
  apiFetch<{ strategy: string }>('/pricing/strategy', { token });

// ---------- Delivery OTP (Phase 7) ----------

export const verifyDeliveryOtp = (shipmentId: string, code: string, token?: string) =>
  apiFetch<{ delivered: boolean; otpApplied: boolean; awb: string; status: string }>(
    `/shipments/${shipmentId}/verify-delivery-otp`,
    {
      body: { code },
      token,
    },
  );

export const resendDeliveryOtp = (shipmentId: string, token?: string) =>
  apiFetch<{ issued: boolean; code?: string; awb: string }>(
    `/shipments/${shipmentId}/resend-delivery-otp`,
    {
      body: {},
      token,
    },
  );

export const supervisorDeliveryBypass = (
  shipmentId: string,
  reason: string,
  proofUrl?: string,
  token?: string,
) =>
  apiFetch<{ delivered: boolean; bypass: boolean; awb: string; status: string }>(
    `/shipments/${shipmentId}/delivery-exception-bypass`,
    {
      body: { reason, proofUrl },
      token,
    },
  );

export const failDelivery = (
  shipmentId: string,
  reason: string,
  exceptionCode?: string,
  token?: string,
) =>
  apiFetch<{ failed: boolean; rtoInitiated: boolean; attempts: number; awb: string }>(
    `/shipments/${shipmentId}/delivery-failed`,
    {
      body: { reason, exceptionCode },
      token,
    },
  );

// ---------- Phase 5 & 6: Operations, Agents, Hubs & Manifests ----------

export interface AgentSummary {
  id: string;
  userId: string;
  name: string;
  phone: string;
  cityId: string;
  cityName: string;
  isOnline: boolean;
  activeTaskCount: number;
}

export interface HydratedTask {
  id: string;
  type: 'PICKUP' | 'DELIVERY' | 'RTO_RETURN' | 'HUB_TRANSFER';
  shipmentId: string;
  agentId?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  status: 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  scheduledFor?: string | null;
  failureReason?: string | null;
  attemptNo: number;
  createdAt: string;
  completedAt?: string | null;
  shipment: {
    id: string;
    awb: string;
    status: string;
    serviceType: string;
    shipmentType: string;
    paymentStatus: string;
    bookCount: number;
    parcelCount: number;
    packages: Array<{ id: string; barcode: string; chargeableWeightKg: string }>;
    legs: ShipmentLeg[];
    pickupAddress: AddressInput | null;
    deliveryAddress: AddressInput | null;
  } | null;
}

export interface AgentProfileResponse {
  agent: {
    id: string;
    userId: string;
    name: string;
    phone: string;
    cityId: string;
    cityName: string | null;
    isOnline: boolean;
  } | null;
  isStaff: boolean;
  stats: Record<string, number>;
}

export const getAgentProfile = (token: string) =>
  apiFetch<AgentProfileResponse>('/agent/profile', { token });

export const toggleAgentAvailability = (isOnline: boolean, token: string, agentId?: string) =>
  apiFetch<{ id: string; isOnline: boolean }>('/agent/availability', {
    body: { isOnline, agentId },
    token,
  });

export const listAgentTasks = (
  params: { includeUnassigned?: boolean; status?: string; type?: string; agentId?: string } = {},
  token: string,
) => {
  const q = new URLSearchParams();
  if (params.includeUnassigned) q.set('includeUnassigned', 'true');
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  if (params.agentId) q.set('agentId', params.agentId);
  return apiFetch<HydratedTask[]>(`/agent/tasks?${q.toString()}`, { token });
};

export const acceptAgentTask = (taskId: string, token: string, agentId?: string) =>
  apiFetch<HydratedTask>(`/agent/tasks/${taskId}/accept`, {
    body: agentId ? { agentId } : {},
    token,
  });

export const confirmPickupTask = (
  taskId: string,
  payload: { remarks?: string; locationLabel?: string },
  token: string,
) =>
  apiFetch<{ shipmentStatus: string }>(`/agent/pickup/${taskId}/confirm`, {
    body: payload,
    token,
  });

export const failPickupTask = (
  taskId: string,
  payload: { reason: string; exceptionCode?: string },
  token: string,
) =>
  apiFetch<{ shipmentStatus: string }>(`/agent/pickup/${taskId}/fail`, {
    body: payload,
    token,
  });

export const startDeliveryTask = (taskId: string, token: string) =>
  apiFetch<{ shipmentStatus: string; deliveryOtp?: { issued: boolean; code?: string } }>(
    `/agent/delivery/${taskId}/start`,
    { body: {}, token },
  );

export const confirmDeliveryTask = (taskId: string, code: string, token: string) =>
  apiFetch<{ delivered: boolean; shipmentStatus: string }>(`/agent/delivery/${taskId}/confirm`, {
    body: { code },
    token,
  });

export const failDeliveryTask = (
  taskId: string,
  payload: { reason: string; exceptionCode?: string },
  token: string,
) =>
  apiFetch<{ failed: boolean; rtoInitiated: boolean; attempts: number }>(
    `/agent/delivery/${taskId}/fail`,
    { body: payload, token },
  );

export const scanBarcodeAsAgent = (code: string, token: string) =>
  apiFetch<{
    actionTaken: string;
    awb: string;
    shipmentId: string;
    shipmentStatus: string;
    taskId: string;
    taskType: string;
    deliveryOtp?: { issued: boolean; code?: string };
  }>('/agent/scan', { body: { code }, token });

// Staff Task Management
export const listAllTasks = (
  params: { status?: string; type?: string; unassigned?: boolean } = {},
  token: string,
) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  if (params.unassigned) q.set('unassigned', 'true');
  return apiFetch<HydratedTask[]>(`/tasks?${q.toString()}`, { token });
};

export const listAgents = (token: string) => apiFetch<AgentSummary[]>('/tasks/agents', { token });

export const createTask = (
  body: { type: string; shipmentId: string; agentId?: string; dispatchNow?: boolean },
  token: string,
) =>
  apiFetch<{ task: HydratedTask; deliveryOtp?: { issued: boolean; code?: string } }>('/tasks', {
    body,
    token,
  });

export const assignTask = (taskId: string, agentId: string, token: string) =>
  apiFetch<HydratedTask>(`/tasks/${taskId}/assign`, { body: { agentId }, token });

export const autoAssignTasks = (token: string, cityId?: string) =>
  apiFetch<{ assignedCount: number; assignments: Array<{ taskId: string; agentName: string }> }>(
    '/tasks/auto-assign',
    { body: cityId ? { cityId } : {}, token },
  );

// Hubs, Inventory & Manifests (Phase 6)
export interface HubSummary {
  id: string;
  name: string;
  address: string;
  cityId: string;
  cityName: string;
  scanCount: number;
}

export interface VehicleSummary {
  id: string;
  regNo: string;
  type: string;
  capacityKg: number;
  cityId: string;
}

export interface HubInventoryItem {
  shipmentId: string;
  awb: string;
  status: string;
  serviceType: string;
  bookCount: number;
  parcelCount: number;
  scannedAt: string;
  conditionNote?: string | null;
  ageingHours: number;
}

export interface ManifestSummary {
  id: string;
  code: string;
  originHubId: string;
  originHubName: string;
  destinationLabel: string;
  vehicleId?: string | null;
  vehicle?: VehicleSummary | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt?: string | null;
  items: Array<{
    shipmentId: string;
    shipment: { id: string; awb: string; status: string; serviceType: string; bookCount: number } | null;
  }>;
}

export const listHubs = (token: string) =>
  apiFetch<{ hubs: HubSummary[]; vehicles: VehicleSummary[]; cities: Array<{ id: string; name: string }> }>(
    '/hubs',
    { token },
  );

export const createHub = (body: { name: string; cityId: string; address: string }, token: string) =>
  apiFetch<HubSummary>('/hubs', { body, token });

export const createVehicle = (
  body: { regNo: string; type: string; capacityKg: number; cityId: string },
  token: string,
) => apiFetch<VehicleSummary>('/hubs/vehicles', { body, token });

export const getHubInventory = (hubId: string, token: string) =>
  apiFetch<{
    hub: HubSummary;
    inventory: HubInventoryItem[];
    recentScans: Array<{
      id: string;
      awb: string;
      direction: string;
      conditionNote?: string | null;
      scannedAt: string;
      shipmentStatus?: string | null;
    }>;
  }>(`/hubs/${hubId}/inventory`, { token });

export const hubScanIn = (
  hubId: string,
  body: { code: string; conditionNote?: string; hubRole?: 'ORIGIN' | 'DESTINATION' },
  token: string,
) =>
  apiFetch<{ awb: string; shipmentId: string; shipmentStatus: string; statusChanged: boolean }>(
    `/hubs/${hubId}/scan-in`,
    { body, token },
  );

export const hubScanOut = (hubId: string, body: { code: string; conditionNote?: string }, token: string) =>
  apiFetch<{ awb: string; shipmentId: string; shipmentStatus: string }>(`/hubs/${hubId}/scan-out`, {
    body,
    token,
  });

export const listManifests = (token: string) => apiFetch<ManifestSummary[]>('/manifests', { token });

export const createManifest = (
  body: { originHubId: string; destinationLabel: string; vehicleId?: string },
  token: string,
) => apiFetch<ManifestSummary>('/manifests', { body, token });

export const addManifestItems = (manifestId: string, codes: string[], token: string) =>
  apiFetch<{ manifestId: string; added: string[] }>(`/manifests/${manifestId}/items`, {
    body: { codes },
    token,
  });

export const removeManifestItem = (manifestId: string, shipmentId: string, token: string) =>
  apiFetch<{ removed: string }>(`/manifests/${manifestId}/items/${shipmentId}`, {
    method: 'DELETE',
    token,
  });

export const closeManifest = (manifestId: string, token: string) =>
  apiFetch<{ manifest: ManifestSummary; dispatched: Array<{ awb: string; status: string }> }>(
    `/manifests/${manifestId}/close`,
    { body: {}, token },
  );

// ---------- Phase 4 & 9: Authenticated Blob Downloads, Saved Addresses & Admin ----------

export async function downloadAuthenticatedBlob(path: string, filename: string, token: string) {
  const res = await fetchWithAuthRetry(path, { token });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new ApiClientError(res.status, errJson.code ?? 'DOWNLOAD_ERROR', errJson.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const downloadShipmentLabel = (shipmentId: string, awb: string, token: string) =>
  downloadAuthenticatedBlob(`/shipments/${shipmentId}/label`, `label-${awb}.pdf`, token);

export const downloadShipmentInvoice = (shipmentId: string, awb: string, token: string) =>
  downloadAuthenticatedBlob(`/shipments/${shipmentId}/invoice`, `invoice-${awb}.pdf`, token);

export interface SavedAddress extends AddressInput {
  id: string;
  isSaved: boolean;
}

export const listSavedAddresses = (token: string) =>
  apiFetch<SavedAddress[]>('/addresses', { token });

export const saveAddress = (body: AddressInput, token: string) =>
  apiFetch<SavedAddress>('/addresses', { body, token });

export const deleteSavedAddress = (id: string, token: string) =>
  apiFetch<{ deleted: string }>(`/addresses/${id}`, { method: 'DELETE', token });

export interface PricingRuleDTO {
  id: string;
  serviceType: string;
  originZone: string;
  destZone: string;
  maxWeightKg: number;
  price: number;
  etaDays: number;
  isActive: boolean;
}

export interface PricingConfigDTO {
  volumetricDivisor: number;
  weightStepKg: number;
  taxRate: number;
  protectionRate: number;
  pickupFee: number;
  packagingFee: number;
  fragilePackagingFee: number;
  tempPackagingFee?: number;
  codFee?: number;
  codMaxAmount?: number;
  serviceSurcharge: number;
}

export const getPricingAdmin = (token: string) =>
  apiFetch<{ rules: PricingRuleDTO[]; config: PricingConfigDTO }>('/pricing/admin/rules', { token });

export const upsertPricingRule = (
  body: Omit<PricingRuleDTO, 'id'> & { id?: string },
  token: string,
) => apiFetch<PricingRuleDTO>('/pricing/admin/rules', { body, token });

export const updatePricingRule = (
  id: string,
  body: Partial<Pick<PricingRuleDTO, 'maxWeightKg' | 'price' | 'etaDays' | 'isActive'>>,
  token: string,
) => apiFetch<PricingRuleDTO>(`/pricing/admin/rules/${id}`, { method: 'PATCH', body, token });

export const deletePricingRule = (id: string, token: string) =>
  apiFetch<{ deleted: string }>(`/pricing/admin/rules/${id}`, { method: 'DELETE', token });

export const updatePricingConfig = (body: Partial<PricingConfigDTO>, token: string) =>
  apiFetch<PricingConfigDTO>('/pricing/admin/config', { method: 'PATCH', body, token });

export interface AdminCityDTO {
  id: string;
  name: string;
  state: string;
  status: 'ACTIVE' | 'INACTIVE';
  hubs: Array<{ id: string; name: string; address: string }>;
  pincodes: Array<{
    pincode: string;
    zone: string;
    ownPickup: boolean;
    ownDelivery: boolean;
    partnerServiceable: boolean;
  }>;
  prerequisites: {
    missing: string[];
    hubCount: number;
    ownPincodeCount: number;
    pricingRulesCount: number;
  };
}

export const listCitiesAdmin = (token: string) =>
  apiFetch<AdminCityDTO[]>('/serviceability/admin/cities', { token });

export const createCityAdmin = (body: { name: string; state: string }, token: string) =>
  apiFetch<AdminCityDTO>('/serviceability/admin/cities', { body, token });

export const activateCityAdmin = (id: string, token: string) =>
  apiFetch<AdminCityDTO>(`/serviceability/admin/cities/${id}/activate`, { body: {}, token });

export const suspendCityAdmin = (id: string, token: string) =>
  apiFetch<AdminCityDTO>(`/serviceability/admin/cities/${id}/suspend`, { method: 'PATCH', body: {}, token });

export const upsertPincodeAdmin = (
  body: {
    pincode: string;
    cityId: string;
    zone: string;
    ownPickup: boolean;
    ownDelivery: boolean;
    partnerServiceable: boolean;
  },
  token: string,
) => apiFetch<Record<string, unknown>>('/serviceability/admin/pincodes', { body, token });

// ---------- Phase 8: Notifications, Exceptions & Support Tickets ----------

export interface NotificationDTO {
  id: string;
  shipmentId?: string | null;
  channel: string;
  target: string;
  template: string;
  status: string;
  payload?: { subject?: string; message?: string; awb?: string; error?: string } | null;
  createdAt: string;
}

export const listNotifications = (
  params: { status?: string; channel?: string } = {},
  token: string,
) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.channel) q.set('channel', params.channel);
  return apiFetch<NotificationDTO[]>(`/notifications?${q.toString()}`, { token });
};

export const retryNotification = (id: string, token: string) =>
  apiFetch<NotificationDTO>(`/notifications/${id}/retry`, { body: {}, token });

export interface FlaggedEventDTO {
  id: string;
  shipmentId: string;
  kind: string;
  status?: string | null;
  exceptionCode?: string | null;
  rawStatus?: string | null;
  source: string;
  remarks?: string | null;
  flagged: boolean;
  eventTime: string;
  shipment: { id: string; awb: string; status: string; serviceType: string } | null;
}

export interface ExceptionQueueDTO {
  flaggedEvents: FlaggedEventDTO[];
  exceptionEvents: FlaggedEventDTO[];
  troubledShipments: Array<{
    id: string;
    awb: string;
    status: string;
    serviceType: string;
    statusUpdatedAt: string;
  }>;
  exceptionCodes: string[];
}

export const listExceptions = (token: string) => apiFetch<ExceptionQueueDTO>('/exceptions', { token });

export const logException = (
  body: { awbOrShipmentId: string; exceptionCode: string; remarks: string; markLost?: boolean },
  token: string,
) => apiFetch<{ awb: string; shipmentStatus: string }>('/exceptions/log', { body, token });

export const acknowledgeFlaggedEvent = (eventId: string, note: string | undefined, token: string) =>
  apiFetch<FlaggedEventDTO>(`/exceptions/events/${eventId}/acknowledge`, {
    body: note ? { note } : {},
    token,
  });

export interface TicketSummaryDTO {
  id: string;
  shipmentId?: string | null;
  customerId: string;
  subject: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
  type: string;
  createdAt: string;
  messageCount: number;
  lastMessage?: string | null;
  shipment?: { id: string; awb: string; status: string; paymentStatus: string } | null;
  customerName?: string | null;
  customerPhone?: string | null;
}

export interface TicketDetailDTO {
  id: string;
  shipmentId?: string | null;
  subject: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
  type: string;
  createdAt: string;
  shipment?: {
    id: string;
    awb: string;
    status: string;
    paymentStatus: string;
    customerPrice: number | null;
    refunded: number;
  } | null;
  messages: Array<{
    id: string;
    authorUserId: string;
    authorName: string;
    authorRole: string;
    body: string;
    createdAt: string;
  }>;
}

export const listTickets = (params: { status?: string; type?: string } = {}, token: string) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  return apiFetch<TicketSummaryDTO[]>(`/tickets?${q.toString()}`, { token });
};

export const getTicket = (id: string, token: string) => apiFetch<TicketDetailDTO>(`/tickets/${id}`, { token });

export const createTicket = (
  body: { awbOrShipmentId?: string; subject: string; type: string; message: string },
  token: string,
) => apiFetch<TicketSummaryDTO>('/tickets', { body, token });

export const replyTicket = (ticketId: string, body: string, token: string) =>
  apiFetch<{ id: string; body: string }>(`/tickets/${ticketId}/messages`, { body: { body }, token });

export const updateTicketStatus = (
  ticketId: string,
  payload: { status: string; resolutionNote?: string; issueRefundAmount?: number },
  token: string,
) =>
  apiFetch<{ ticket: TicketSummaryDTO; refund?: { refunded: boolean; amount: number } | null }>(
    `/tickets/${ticketId}/status`,
    { method: 'PATCH', body: payload, token },
  );

// ---------- Phase 9: Analytics, KPIs, Finance Ledger & CSV Export ----------

export interface AdminDashboardDTO {
  bookedToday: number;
  inTransit: number;
  delivered: number;
  exceptions: number;
  pendingPickups: number;
  openTickets: number;
  revenue: number;
  partnerCost: number;
  refunded: number;
  netMargin: number;
}

export interface AnalyticsReportDTO {
  summary: {
    totalShipments: number;
    deliveredCount: number;
    inTransitCount: number;
    rtoCount: number;
    failedDeliveryCount: number;
    cancelledCount: number;
    lostCount: number;
    onTimeDeliveryPct: number;
    firstAttemptDeliveryPct: number;
    pickupSuccessPct: number;
    rtoRatePct: number;
    damageLossCount: number;
    damageLossRatePct: number;
  };
  financials: {
    paidShipmentCount: number;
    grossRevenue: number;
    totalTax: number;
    partnerCost: number;
    ownCost: number;
    totalRefunded: number;
    netMargin: number;
  };
  statusDistribution: Array<{ status: string; count: number; pct: number }>;
  carrierPerformance: Array<{
    carrierType: 'OWN' | 'PARTNER';
    shipmentCount: number;
    deliveredCount: number;
    troubledCount: number;
    revenue: number;
    cost: number;
    margin: number;
  }>;
  agentProductivity: Array<{
    agentId: string;
    name: string;
    cityName: string;
    isOnline: boolean;
    pickupsCompleted: number;
    deliveriesCompleted: number;
    failedTasks: number;
    totalCompleted: number;
  }>;
  supportMetrics: { totalTickets: number; openTickets: number; resolvedTickets: number };
}

export interface FinanceLedgerDTO {
  payments: Array<{
    id: string;
    shipmentId: string;
    awb: string | null;
    provider: string;
    amount: number;
    status: string;
    createdAt: string;
  }>;
  refunds: Array<{ id: string; paymentId: string; amount: number; reason: string; createdAt: string }>;
  invoices: Array<{ id: string; number: string; shipmentId: string | null; awb: string | null; total: number; issuedAt: string }>;
}

export const getAdminDashboard = (token: string) =>
  apiFetch<AdminDashboardDTO>('/admin/dashboard', { token });

export const getAnalyticsReport = (
  params: { from?: string; to?: string; carrierType?: string } = {},
  token: string,
) => {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.carrierType) q.set('carrierType', params.carrierType);
  return apiFetch<AnalyticsReportDTO>(`/reports/analytics?${q.toString()}`, { token });
};

export const getFinanceLedger = (token: string) => apiFetch<FinanceLedgerDTO>('/reports/finance', { token });

export const downloadShipmentsCsv = (
  params: { from?: string; to?: string; carrierType?: string } = {},
  token: string,
) => {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.carrierType) q.set('carrierType', params.carrierType);
  return downloadAuthenticatedBlob(
    `/reports/export/shipments.csv?${q.toString()}`,
    'bookcourier-shipments-report.csv',
    token,
  );
};

// ---------- Enterprise Courier, Promos, B2B, Inquiries & Governance APIs ----------

export interface PromoCodeDTO {
  id: string;
  code: string;
  description: string;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number;
  maxDiscount?: number | null;
  minOrderAmount: number;
  usageLimit?: number | null;
  usedCount?: number;
  validUntil?: string | null;
  isActive?: boolean;
}

export const getActivePromos = () => apiFetch<PromoCodeDTO[]>('/promos/active');

export const validatePromo = (code: string, subtotal: number) =>
  apiFetch<{ valid: boolean; code: string; discountAmount: number; description?: string; reason?: string }>(
    '/promos/validate',
    { body: { code, subtotal } },
  );

export const listAdminPromos = (token: string) => apiFetch<PromoCodeDTO[]>('/promos/admin', { token });

export const upsertPromoCode = (
  body: {
    code: string;
    description: string;
    discountType: 'PERCENT' | 'FLAT';
    discountValue: number;
    maxDiscount?: number | null;
    minOrderAmount?: number;
    usageLimit?: number | null;
    isActive?: boolean;
  },
  token: string,
) => apiFetch<PromoCodeDTO>('/promos/admin', { body, token });

export const togglePromoCode = (id: string, isActive: boolean, token: string) =>
  apiFetch<PromoCodeDTO>(`/promos/admin/${id}`, { method: 'PATCH', body: { isActive }, token });

export interface NetworkCoverageDTO {
  activeCities: Array<{ id: string; name: string; state: string }>;
  samplePincodes: Array<{
    pincode: string;
    zone: string;
    ownPickup: boolean;
    ownDelivery: boolean;
    partnerServiceable: boolean;
    city: { name: string; state: string; status: string };
  }>;
  hubs: Array<{ id: string; name: string; address: string; city: { name: string; state: string } }>;
  carriers: Array<{ code: string; name: string; type: 'OWN' | 'PARTNER'; settings?: unknown }>;
  internationalDestinations: Array<{
    code: string;
    name: string;
    transitDays: number;
    startingPriceInr: number;
  }>;
}

export const getNetworkCoverage = () => apiFetch<NetworkCoverageDTO>('/serviceability/network');

export const checkServiceability = (from: string, to: string, country = 'IN') =>
  apiFetch<{
    serviceable: boolean;
    own: boolean;
    partner: boolean;
    international: boolean;
    from: { city: string; zone: string } | null;
    to: { city: string; zone: string } | null;
    estimatedDays?: number;
  }>(`/serviceability/check?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&country=${encodeURIComponent(country)}`);

export const cancelShipment = (shipmentId: string, reason: string | undefined, token: string) =>
  apiFetch<{ shipment: any; refunded: number }>(`/shipments/${shipmentId}/cancel`, {
    body: { reason },
    token,
  });

export const submitNdrAction = (
  shipmentId: string,
  payload: {
    action: 'RESCHEDULE' | 'UPDATE_ADDRESS' | 'RTO';
    rescheduleDate?: string;
    newLine1?: string;
    newPhone?: string;
    remarks?: string;
  },
  token: string,
) => apiFetch<{ shipment: any; action: string }>(`/shipments/${shipmentId}/ndr-action`, { body: payload, token });

// ---------- B2B Corporate, Bulk CSV & ONDC/E-Commerce APIs ----------

export interface B2BProfileDTO {
  customerType: 'INDIVIDUAL' | 'BUSINESS';
  businessAccount: {
    id: string;
    legalName: string;
    gstin?: string | null;
    creditLimit: number;
    isApproved: boolean;
    contracts: Array<{ id: string; ruleJson: any; validFrom: string; validTo?: string | null }>;
  } | null;
  apiKeys: Array<{
    id: string;
    label: string;
    keyPrefix: string;
    webhookUrl?: string | null;
    ondcSubscriberId?: string | null;
    isActive: boolean;
    lastUsedAt?: string | null;
    createdAt: string;
  }>;
}

export interface BulkRowInput {
  fromPincode: string;
  toPincode: string;
  recipientName: string;
  recipientPhone: string;
  recipientLine1: string;
  recipientCity: string;
  recipientState: string;
  weightKg: number;
  serviceType: string;
  packaging: string;
  fulfillmentMode: 'OWN' | 'PARTNER';
  paymentMethod: 'PREPAID' | 'COD' | 'CORPORATE_CREDIT';
  goodsDescription?: string;
  destinationCountry?: string;
}

export const getB2BProfile = (token: string) => apiFetch<B2BProfileDTO>('/b2b/profile', { token });

export const applyB2BAccount = (
  body: { legalName: string; gstin?: string; requestedCreditLimit?: number },
  token: string,
) => apiFetch<B2BProfileDTO['businessAccount']>('/b2b/account', { body, token });

export const bulkQuote = (rows: BulkRowInput[], token: string) =>
  apiFetch<{
    results: Array<{
      index: number;
      ok: boolean;
      optionId?: string;
      carrierCodes?: string[];
      price?: number;
      etaDays?: number;
      error?: string;
    }>;
    totalAmount: number;
    hasCorporateRate: boolean;
  }>('/b2b/bulk-quote', { body: { rows }, token });

export const bulkBookShipments = (
  pickupAddress: AddressInput,
  rows: BulkRowInput[],
  token: string,
) =>
  apiFetch<{
    createdCount: number;
    failedCount: number;
    created: Array<{ index: number; awb: string; price: string; carrierMode: string }>;
    failed: Array<{ index: number; recipientName: string; error: string }>;
  }>('/b2b/bulk-book', { body: { pickupAddress, rows }, token });

export const createPartnerApiKey = (
  body: { label: string; webhookUrl?: string; ondcSubscriberId?: string },
  token: string,
) =>
  apiFetch<{
    id: string;
    label: string;
    keyPrefix: string;
    plaintextKey: string;
    webhookUrl?: string | null;
    ondcSubscriberId?: string | null;
    createdAt: string;
  }>('/b2b/api-keys', { body, token });

export const deletePartnerApiKey = (id: string, token: string) =>
  apiFetch<{ deleted: string }>(`/b2b/api-keys/${id}`, { method: 'DELETE', token });

export const testPartnerWebhook = (id: string, token: string) =>
  apiFetch<{ delivered: boolean; httpStatus: number | null; detail: string; signature: string; payload: any }>(
    `/b2b/api-keys/${id}/test-webhook`,
    { body: {}, token },
  );

export const listAdminB2BAccounts = (token: string) => apiFetch<any[]>('/b2b/admin/accounts', { token });

export const updateAdminB2BAccount = (
  id: string,
  body: { isApproved?: boolean; creditLimit?: number; discountPct?: number },
  token: string,
) => apiFetch<any>(`/b2b/admin/accounts/${id}`, { method: 'PATCH', body, token });

// ---------- 3PL, FTL, Cold-Chain & Franchise Inquiries ----------

export interface LogisticsInquiryDTO {
  id: string;
  customerName: string;
  email: string;
  phone: string;
  companyName?: string | null;
  solutionType: string;
  originCity?: string | null;
  destCity?: string | null;
  monthlyVolume?: string | null;
  temperatureRange?: string | null;
  notes: string;
  status: string;
  adminNotes?: string | null;
  createdAt: string;
}

export const submitInquiry = (
  body: {
    customerName: string;
    email: string;
    phone: string;
    companyName?: string;
    solutionType: string;
    originCity?: string;
    destCity?: string;
    monthlyVolume?: string;
    temperatureRange?: string;
    notes: string;
  },
  token?: string,
) => apiFetch<LogisticsInquiryDTO>('/inquiries', { body, token });

export const listInquiries = (token: string) => apiFetch<LogisticsInquiryDTO[]>('/inquiries', { token });

export const updateInquiryStatus = (
  id: string,
  body: { status: string; adminNotes?: string },
  token: string,
) => apiFetch<LogisticsInquiryDTO>(`/inquiries/${id}`, { method: 'PATCH', body, token });

// ---------- Admin Bulk CSV, COD, Audit, Webhooks & Config ----------

export const bulkUpsertPincodes = (
  rows: Array<{
    pincode: string;
    cityId: string;
    zone: string;
    ownPickup: boolean;
    ownDelivery: boolean;
    partnerServiceable: boolean;
  }>,
  token: string,
) =>
  apiFetch<{ imported: number; failed: number; errors: Array<{ pincode: string; reason: string }> }>(
    '/serviceability/admin/pincodes/bulk',
    { body: { rows }, token },
  );

export const bulkUpsertPricingRules = (
  rows: Array<{
    serviceType: string;
    originZone: string;
    destZone: string;
    maxWeightKg: number;
    price: number;
    etaDays: number;
    isActive?: boolean;
  }>,
  token: string,
) => apiFetch<{ imported: number }>('/pricing/admin/rules/bulk', { body: { rows }, token });

export interface CodReportDTO {
  summary: { pendingCollection: number; awaitingRemittance: number; remittedTotal: number };
  shipments: Array<{
    id: string;
    awb: string;
    status: string;
    codAmount: number;
    codCollected: boolean;
    codRemitted: boolean;
    paymentStatus: string;
    createdAt: string;
  }>;
}

export const getCodReport = (token: string) => apiFetch<CodReportDTO>('/reports/cod', { token });

export const remitCodShipment = (shipmentId: string, token: string) =>
  apiFetch<{ id: string; awb: string; codRemitted: boolean }>(`/reports/cod/${shipmentId}/remit`, {
    body: {},
    token,
  });

export const listAuditLogs = (actionFilter: string | undefined, token: string) => {
  const q = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : '';
  return apiFetch<
    Array<{
      id: string;
      action: string;
      entity: string;
      entityId: string;
      after: any;
      createdAt: string;
      actor?: { name: string; email?: string | null } | null;
    }>
  >(`/admin/audit-logs${q}`, { token });
};

export const listWebhookLogs = (token: string) =>
  apiFetch<
    Array<{
      id: string;
      carrierCode: string;
      body: any;
      processed: boolean;
      error?: string | null;
      receivedAt: string;
    }>
  >('/admin/webhooks', { token });

export interface CompanySettingsDTO {
  profile: {
    brandName: string;
    gstin: string;
    address: string;
    supportEmail: string;
    supportPhone: string;
  };
  channels: { smsProvider: string; emailProvider: string; paymentGateway: string };
}

export const getCompanySettings = (token: string) =>
  apiFetch<CompanySettingsDTO>('/admin/settings/company', { token });

export const updateCompanySettings = (profile: CompanySettingsDTO['profile'], token: string) =>
  apiFetch<{ profile: CompanySettingsDTO['profile'] }>('/admin/settings/company', {
    method: 'PATCH',
    body: profile,
    token,
  });

export const getNetworkOverview = (token: string) =>
  apiFetch<{
    cities: Array<{ id: string; name: string; state: string; status: string; _count: { pincodes: number; hubs: number } }>;
    hubs: Array<{ id: string; name: string; address: string; city: { name: string; state: string } }>;
    vehicles: VehicleSummary[];
    carriers: Carrier[];
    openNdr: number;
    manifests: Array<{ id: string; code: string; destinationLabel: string; status: string; _count: { items: number } }>;
  }>('/admin/network-overview', { token });






