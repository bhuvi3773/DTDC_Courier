// Frontend RBAC & feature-visibility policy mirroring backend route guards.

export type AdminTabId = 'ops' | 'pricing' | 'phase8' | 'phase9' | 'enterprise' | 'governance';

export type RoleTier = 'GUEST' | 'CUSTOMER' | 'EMPLOYEE' | 'SUPER_ADMIN';

export interface NavItem {
  href: string;
  label: string;
  matchPrefix: string;
}

export interface RoleCapabilities {
  tier: RoleTier;
  role: string | null;
  label: string;
  defaultHome: string;
  canViewCustomerOrders: boolean;
  canViewCustomerSupport: boolean;
  canViewBusinessPortal: boolean;
  canViewAgentPortal: boolean;
  canViewHubsPortal: boolean;
  canManageHubsAndManifests: boolean;
  canCreateHub: boolean;
  canCreateVehicle: boolean;
  canViewAdminConsole: boolean;
  adminTabs: AdminTabId[];
  canManageRoutingAndCarriers: boolean;
  canViewCarriers: boolean;
  canViewDashboardKpi: boolean;
  canViewFinancialMetrics: boolean;
  canManageTasks: boolean;
  canBypassDeliveryOtp: boolean;
  canUpdateShipmentEvents: boolean;
  canManageTickets: boolean;
  canIssueRefund: boolean;
  canManageExceptions: boolean;
  canViewNotifications: boolean;
  canViewAnalytics: boolean;
  canViewFinanceLedger: boolean;
  canManageEnterprise: boolean;
  canViewGovernance: boolean;
}

const CUSTOMER_ROLES = new Set(['CUSTOMER', 'BUSINESS_OWNER', 'BUSINESS_USER']);
const AGENT_PORTAL_ROLES = new Set(['AGENT', 'SUPERVISOR', 'HUB_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN']);
const HUB_MANAGE_ROLES = new Set(['HUB_MANAGER', 'SUPERVISOR', 'CITY_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN']);
const ADMIN_CONSOLE_ROLES = new Set([
  'SUPER_ADMIN',
  'OPS_MANAGER',
  'CITY_MANAGER',
  'HUB_MANAGER',
  'SUPERVISOR',
  'SUPPORT',
  'FINANCE',
]);

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  OPS_MANAGER: 'Ops Manager',
  CITY_MANAGER: 'City Manager',
  HUB_MANAGER: 'Hub Manager',
  SUPERVISOR: 'Supervisor',
  SUPPORT: 'Support',
  FINANCE: 'Finance',
  AGENT: 'Field Agent',
  CUSTOMER: 'Customer',
  BUSINESS_OWNER: 'Business Owner',
  BUSINESS_USER: 'Business User',
};

export function defaultHomeForRole(role: string | null | undefined): string {
  switch (role) {
    case 'AGENT':
      return '/agent';
    case 'HUB_MANAGER':
      return '/hubs';
    case 'SUPPORT':
      return '/admin?tab=phase8';
    case 'FINANCE':
      return '/admin?tab=phase9';
    case 'CITY_MANAGER':
      return '/admin?tab=pricing';
    case 'SUPERVISOR':
    case 'OPS_MANAGER':
    case 'SUPER_ADMIN':
      return '/admin';
    case 'CUSTOMER':
    case 'BUSINESS_OWNER':
    case 'BUSINESS_USER':
      return '/';
    default:
      return '/login';
  }
}

export function getRoleCapabilities(role: string | null | undefined): RoleCapabilities {
  const r = role ?? null;
  const inSet = (allowed: string[]) => (r !== null ? allowed.includes(r) : false);

  let tier: RoleTier = 'GUEST';
  if (r === 'SUPER_ADMIN') tier = 'SUPER_ADMIN';
  else if (r && CUSTOMER_ROLES.has(r)) tier = 'CUSTOMER';
  else if (r) tier = 'EMPLOYEE';

  const adminTabs: AdminTabId[] = [];
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR'])) {
    adminTabs.push('ops');
  }
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER'])) {
    adminTabs.push('pricing');
  }
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR', 'SUPPORT', 'FINANCE'])) {
    adminTabs.push('phase8');
  }
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'FINANCE'])) {
    adminTabs.push('phase9');
  }
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'FINANCE'])) {
    adminTabs.push('enterprise');
  }
  if (inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE'])) {
    adminTabs.push('governance');
  }

  return {
    tier,
    role: r,
    label: r ? (ROLE_LABELS[r] ?? r) : 'Guest',
    defaultHome: defaultHomeForRole(r),
    canViewCustomerOrders: r !== null && (CUSTOMER_ROLES.has(r) || r === 'SUPER_ADMIN'),
    canViewCustomerSupport:
      r !== null && (CUSTOMER_ROLES.has(r) || inSet(['SUPER_ADMIN', 'SUPPORT', 'OPS_MANAGER', 'SUPERVISOR', 'FINANCE'])),
    canViewBusinessPortal: r !== null && (CUSTOMER_ROLES.has(r) || inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'ACCOUNT_MANAGER'])),
    canViewAgentPortal: r !== null && AGENT_PORTAL_ROLES.has(r),
    canViewHubsPortal: r !== null && (HUB_MANAGE_ROLES.has(r) || r === 'AGENT'),
    canManageHubsAndManifests: r !== null && HUB_MANAGE_ROLES.has(r),
    canCreateHub: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER']),
    canCreateVehicle: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'HUB_MANAGER']),
    canViewAdminConsole: r !== null && ADMIN_CONSOLE_ROLES.has(r),
    adminTabs,
    canManageRoutingAndCarriers: inSet(['SUPER_ADMIN', 'OPS_MANAGER']),
    canViewCarriers: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'HUB_MANAGER']),
    canViewDashboardKpi: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'FINANCE']),
    canViewFinancialMetrics: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE']),
    canManageTasks: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR']),
    canBypassDeliveryOtp: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'HUB_MANAGER', 'SUPERVISOR']),
    canUpdateShipmentEvents: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR', 'SUPPORT']),
    canManageTickets: inSet(['SUPER_ADMIN', 'SUPPORT', 'OPS_MANAGER', 'SUPERVISOR', 'FINANCE']),
    canIssueRefund: inSet(['SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER', 'SUPPORT']),
    canManageExceptions: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR', 'SUPPORT']),
    canViewNotifications: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'SUPPORT', 'SUPERVISOR', 'HUB_MANAGER']),
    canViewAnalytics: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'FINANCE']),
    canViewFinanceLedger: inSet(['SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER']),
    canManageEnterprise: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'FINANCE']),
    canViewGovernance: inSet(['SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE']),
  };
}

export function getNavItems(role: string | null | undefined): NavItem[] {
  const r = role ?? null;

  if (!r) {
    return [
      { href: '/courier', label: 'Courier Services', matchPrefix: '/courier' },
      { href: '/track', label: 'Track', matchPrefix: '/track' },
    ];
  }

  if (CUSTOMER_ROLES.has(r)) {
    return [
      { href: '/book', label: 'Ship Now', matchPrefix: '/book' },
      { href: '/business', label: 'B2B & Bulk CSV', matchPrefix: '/business' },
      { href: '/orders', label: 'My Shipments', matchPrefix: '/orders' },
      { href: '/track', label: 'Track', matchPrefix: '/track' },
      { href: '/support', label: 'Support', matchPrefix: '/support' },
    ];
  }

  switch (r) {
    case 'AGENT':
      return [
        { href: '/agent', label: 'Agent App', matchPrefix: '/agent' },
        { href: '/hubs', label: 'Hub Scan', matchPrefix: '/hubs' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'HUB_MANAGER':
      return [
        { href: '/hubs', label: 'Hub Ops', matchPrefix: '/hubs' },
        { href: '/agent', label: 'Agent Desk', matchPrefix: '/agent' },
        { href: '/admin', label: 'Operations', matchPrefix: '/admin' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'SUPERVISOR':
      return [
        { href: '/admin', label: 'Operations', matchPrefix: '/admin' },
        { href: '/agent', label: 'Agent Desk', matchPrefix: '/agent' },
        { href: '/hubs', label: 'Hub Ops', matchPrefix: '/hubs' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'SUPPORT':
      return [
        { href: '/admin?tab=phase8', label: 'Support & Alerts', matchPrefix: '/admin' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'FINANCE':
      return [
        { href: '/admin?tab=phase9', label: 'Finance & COD', matchPrefix: '/admin' },
        { href: '/admin?tab=enterprise', label: 'B2B & Promos', matchPrefix: '/admin?tab=enterprise' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'CITY_MANAGER':
      return [
        { href: '/admin?tab=pricing', label: 'Pricing & Cities', matchPrefix: '/admin' },
        { href: '/hubs', label: 'Hub Ops', matchPrefix: '/hubs' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'OPS_MANAGER':
      return [
        { href: '/admin', label: 'Ops Console', matchPrefix: '/admin' },
        { href: '/agent', label: 'Agent Desk', matchPrefix: '/agent' },
        { href: '/hubs', label: 'Hub Ops', matchPrefix: '/hubs' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
    case 'SUPER_ADMIN':
    default:
      return [
        { href: '/admin', label: 'Admin Console', matchPrefix: '/admin' },
        { href: '/agent', label: 'Agent Desk', matchPrefix: '/agent' },
        { href: '/hubs', label: 'Hub Ops', matchPrefix: '/hubs' },
        { href: '/track', label: 'Track', matchPrefix: '/track' },
      ];
  }
}
