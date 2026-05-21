'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Bell, Check, Trash2, Settings, UserPlus, 
  CheckCircle2, XCircle, MessageSquare, AlertCircle, 
  PauseCircle, MinusCircle, Info, MoreHorizontal, Eye,
  Sliders, Mail, Sparkles, ArrowRight
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/src/components/ui/dropdown-menu'
import { Button } from '@/src/components/ui/button'
import { Badge } from '@/src/components/ui/badge'
import { Switch } from '@/src/components/ui/switch'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/src/components/ui/card'
import { toast } from 'sonner'

// Layout Imports
import { AdminLayout } from '@/src/components/AdminLayout'
import { OpsLayout } from '@/src/components/OpsLayout'
import { ClientLayout } from '@/src/components/ClientLayout'
import { SubLayout } from '@/src/components/SubLayout'

interface PreferenceItem {
  key: string;
  label: string;
  description: string;
  inAppKey: string;
  emailKey: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'dashboard' | 'preferences'>('dashboard')
  const [profile, setProfile] = useState<any>(null)
  const [isProfileLoading, setIsProfileLoading] = useState(true)

  // Fetch logged-in user profile to determine correct portal layout wrapper
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/profile')
        if (res.ok) {
          const data = await res.json()
          setProfile(data)
        }
      } catch (err) {
        console.error('Failed to load profile:', err)
      } finally {
        setIsProfileLoading(false)
      }
    }
    loadProfile()
  }, [])

  // Fetch Notifications
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications')
      if (!res.ok) throw new Error('Failed to fetch notifications')
      const json = await res.json()
      return json.data || []
    }
  })

  // Fetch Unread Count
  const { data: unreadCountData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/unread-count')
      if (!res.ok) throw new Error('Failed to fetch unread count')
      const json = await res.json()
      return json.count || 0
    }
  })

  const unreadCount = typeof unreadCountData === 'number' ? unreadCountData : notifications.filter((n: any) => !n.read).length

  // Fetch Preferences Object
  const { data: preferences = {}, isLoading: isPrefLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await fetch('/api/notification-preferences')
      if (!res.ok) throw new Error('Failed to fetch notification preferences')
      const json = await res.json()
      return json.data || {}
    }
  })

  // Update Specific Preference Mutation
  const updatePreferenceMutation = useMutation({
    mutationFn: async (payload: { key: string; value: boolean }) => {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update preference');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      toast.success('Notification preference updated successfully');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update preference');
    }
  });

  // Update Notification (Read/Dismiss) Mutation
  const updateNotificationMutation = useMutation({
    mutationFn: async ({ id, read, dismissed }: { id: string; read?: boolean; dismissed?: boolean }) => {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read, dismissed }),
      });
      if (!res.ok) throw new Error('Failed to update notification');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update notification');
    }
  });

  // Mark All Read Mutation
  const readAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error('Failed to mark all as read');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      toast.success('All notifications marked as read');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to mark all as read');
    }
  });

  // Helper: Classification for Client Activity
  const isClientActivity = (notif: any) => {
    const clientTypes = ['case_approved', 'case_rejected', 'case_feedback', 'case_cancel', 'case_hold'];
    if (clientTypes.includes(notif.type)) return true;
    if (notif.type === 'chat_message') {
      const msg = notif.message?.toLowerCase() || '';
      const title = notif.title?.toLowerCase() || '';
      return msg.includes('client') || title.includes('client') || msg.includes('subuser');
    }
    return false;
  };

  // Helper: Get Icon & Styles for Notification Card
  const getNotificationConfig = (type: string) => {
    switch (type) {
      case 'case_approved':
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
          borderColor: 'border-l-emerald-500',
          bgColor: 'bg-emerald-50/40'
        };
      case 'case_rejected':
      case 'case_cancel':
        return {
          icon: <XCircle className="w-5 h-5 text-rose-500" />,
          borderColor: 'border-l-rose-500',
          bgColor: 'bg-rose-50/40'
        };
      case 'case_feedback':
        return {
          icon: <MessageSquare className="w-5 h-5 text-indigo-500" />,
          borderColor: 'border-l-indigo-500',
          bgColor: 'bg-indigo-50/40'
        };
      case 'case_hold':
        return {
          icon: <PauseCircle className="w-5 h-5 text-amber-500" />,
          borderColor: 'border-l-amber-500',
          bgColor: 'bg-amber-50/40'
        };
      case 'case_assigned':
        return {
          icon: <UserPlus className="w-5 h-5 text-[#00786f]" />,
          borderColor: 'border-l-[#00786f]',
          bgColor: 'bg-teal-50/30'
        };
      case 'chat_message':
        return {
          icon: <MessageSquare className="w-5 h-5 text-sky-500" />,
          borderColor: 'border-l-sky-500',
          bgColor: 'bg-sky-50/40'
        };
      default:
        return {
          icon: <Info className="w-5 h-5 text-slate-500" />,
          borderColor: 'border-l-slate-300',
          bgColor: 'bg-slate-50/50'
        };
    }
  };

  const clientNotifications = notifications.filter(isClientActivity);
  const internalNotifications = notifications.filter((n: any) => !isClientActivity(n));

  // Defined dynamic mappings for fine-grained toggles matching database preference columns
  const PREFERENCE_MAPPINGS: PreferenceItem[] = [
    {
      key: 'case_assigned',
      label: 'Case Assignments',
      description: 'Receive alerts when a new case is assigned or claimed.',
      inAppKey: 'caseAssignedInApp',
      emailKey: 'caseAssignedEmail'
    },
    {
      key: 'case_feedback',
      label: 'Design Feedback',
      description: 'Receive alerts when client comments or revision feedback are submitted.',
      inAppKey: 'caseFeedbackInApp',
      emailKey: 'caseFeedbackEmail'
    },
    {
      key: 'case_approved',
      label: 'Case Approvals',
      description: 'Receive alerts when designs are approved by the client lab.',
      inAppKey: 'caseApprovedInApp',
      emailKey: 'caseApprovedEmail'
    },
    {
      key: 'case_rejected',
      label: 'Case Rejections',
      description: 'Receive alerts when designs are rejected or need changes.',
      inAppKey: 'caseRejectedInApp',
      emailKey: 'caseRejectedEmail'
    },
    {
      key: 'case_hold',
      label: 'Hold States',
      description: 'Receive alerts when a case is put on hold.',
      inAppKey: 'caseHoldInApp',
      emailKey: 'caseHoldEmail'
    },
    {
      key: 'case_cancel',
      label: 'Cancellations',
      description: 'Receive alerts when a case is cancelled.',
      inAppKey: 'caseCancelInApp',
      emailKey: 'caseCancelEmail'
    },
    {
      key: 'chat_message',
      label: 'Live Chat Messages',
      description: 'Receive alerts when a direct chat message is posted in the case chat.',
      inAppKey: 'chatMessageInApp',
      emailKey: 'chatMessageEmail'
    }
  ];

  // Dynamic selector to wrap contents with correct role sidebar and layout
  const LayoutWrapper = ({ children }: { children: React.ReactNode }) => {
    if (isProfileLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-slate-500 text-sm font-medium">Securing session layout...</p>
          </div>
        </div>
      )
    }

    const role = profile?.role
    if (role === 'client') return <ClientLayout>{children}</ClientLayout>
    if (role === 'subuser') return <SubLayout>{children}</SubLayout>
    if (role === 'admin') return <AdminLayout>{children}</AdminLayout>
    return <OpsLayout>{children}</OpsLayout>
  }

  return (
    <LayoutWrapper>
      <div className="min-h-screen bg-slate-50/40 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Header Area */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#00786f]/10 text-[#00786f] rounded-xl">
                  <Bell className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                    Notification Center
                    {unreadCount > 0 && (
                      <Badge className="bg-rose-500 hover:bg-rose-600 text-white rounded-full px-2.5 py-0.5 text-xs font-semibold">
                        {unreadCount} Unread
                      </Badge>
                    )}
                  </h1>
                  <p className="text-slate-500 text-sm">Orchestrate case updates, feedback, and personal delivery preferences.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end md:self-center">
              <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'dashboard'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Sliders className="w-4 h-4" /> Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('preferences')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'preferences'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Settings className="w-4 h-4" /> Preferences
                </button>
              </div>

              {activeTab === 'dashboard' && (
                <Button 
                  onClick={() => readAllMutation.mutate()}
                  variant="outline"
                  size="sm"
                  disabled={unreadCount === 0}
                  className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm"
                >
                  <Check className="w-4 h-4 mr-2" /> Mark all read
                </Button>
              )}
            </div>
          </div>

          {/* MAIN CONTENT AREA */}
          {activeTab === 'dashboard' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* LEFT COLUMN: Client Activities & Live Feedback */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-500" />
                    <h2 className="text-lg font-semibold text-slate-900">Client Activities & Live Feedback</h2>
                  </div>
                  <Badge variant="outline" className="bg-white border-slate-200 text-slate-600">
                    {clientNotifications.length} alerts
                  </Badge>
                </div>

                <div className="space-y-3">
                  {isLoading ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-500 shadow-sm">
                      Loading client events...
                    </div>
                  ) : clientNotifications.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center shadow-sm">
                      <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 font-medium text-sm">All caught up with client feedback!</p>
                    </div>
                  ) : (
                    clientNotifications.map((notif: any) => {
                      const cfg = getNotificationConfig(notif.type);
                      return (
                        <div
                          key={notif.id}
                          className={`group relative bg-white rounded-xl border border-l-4 transition-all duration-200 hover:shadow-md ${
                            cfg.borderColor
                          } ${notif.read ? 'border-slate-100 opacity-70' : 'border-slate-200 shadow-sm'}`}
                        >
                          <div className="p-4 flex items-start gap-4">
                            <div className={`p-2.5 rounded-xl ${cfg.bgColor} flex-shrink-0`}>
                              {cfg.icon}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className={`text-sm font-semibold truncate ${notif.read ? 'text-slate-500' : 'text-slate-900'}`}>
                                  {notif.title}
                                </h4>
                                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                  {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                              <p className={`text-xs leading-relaxed ${notif.read ? 'text-slate-400' : 'text-slate-600'}`}>
                                {notif.message}
                              </p>
                              
                              {notif.link && (
                                <a 
                                  href={notif.link}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#00786f] mt-2 hover:underline"
                                >
                                  Open details <ArrowRight className="w-3 h-3" />
                                </a>
                              )}
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 rounded-lg">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => updateNotificationMutation.mutate({ id: notif.id, read: !notif.read })}>
                                    <Check className="w-4 h-4 mr-2" /> Mark as {notif.read ? 'unread' : 'read'}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => updateNotificationMutation.mutate({ id: notif.id, dismissed: true })}
                                    className="text-rose-600 focus:text-rose-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Dismiss
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          {!notif.read && (
                            <div className="absolute right-3 top-3 w-2.5 h-2.5 rounded-full bg-[#00786f]" />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: Internal Operations & Case Flow */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-teal-500" />
                    <h2 className="text-lg font-semibold text-slate-900">Internal Operations & Case Flow</h2>
                  </div>
                  <Badge variant="outline" className="bg-white border-slate-200 text-slate-600">
                    {internalNotifications.length} alerts
                  </Badge>
                </div>

                <div className="space-y-3">
                  {isLoading ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-500 shadow-sm">
                      Loading internal events...
                    </div>
                  ) : internalNotifications.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center shadow-sm">
                      <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 font-medium text-sm">All caught up with internal operations!</p>
                    </div>
                  ) : (
                    internalNotifications.map((notif: any) => {
                      const cfg = getNotificationConfig(notif.type);
                      return (
                        <div
                          key={notif.id}
                          className={`group relative bg-white rounded-xl border border-l-4 transition-all duration-200 hover:shadow-md ${
                            cfg.borderColor
                          } ${notif.read ? 'border-slate-100 opacity-70' : 'border-slate-200 shadow-sm'}`}
                        >
                          <div className="p-4 flex items-start gap-4">
                            <div className={`p-2.5 rounded-xl ${cfg.bgColor} flex-shrink-0`}>
                              {cfg.icon}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <h4 className={`text-sm font-semibold truncate ${notif.read ? 'text-slate-500' : 'text-slate-900'}`}>
                                  {notif.title}
                                </h4>
                                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                  {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                              <p className={`text-xs leading-relaxed ${notif.read ? 'text-slate-400' : 'text-slate-600'}`}>
                                {notif.message}
                              </p>
                              
                              {notif.link && (
                                <a 
                                  href={notif.link}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#00786f] mt-2 hover:underline"
                                >
                                  Open details <ArrowRight className="w-3 h-3" />
                                </a>
                              )}
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 rounded-lg">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => updateNotificationMutation.mutate({ id: notif.id, read: !notif.read })}>
                                    <Check className="w-4 h-4 mr-2" /> Mark as {notif.read ? 'unread' : 'read'}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => updateNotificationMutation.mutate({ id: notif.id, dismissed: true })}
                                    className="text-rose-600 focus:text-rose-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Dismiss
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          {!notif.read && (
                            <div className="absolute right-3 top-3 w-2.5 h-2.5 rounded-full bg-[#00786f]" />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

            </div>
          ) : (
            
            /* PREFERENCES SETTINGS */
            <div className="max-w-3xl mx-auto space-y-6">
              <Card className="bg-white border-slate-100 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6">
                  <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-[#00786f]" /> Delivery Channels & Alerts
                  </CardTitle>
                  <CardDescription className="text-slate-500 text-xs">
                    Choose how and when you receive in-app notifications and email summaries.
                  </CardDescription>
                </CardHeader>
                <CardContent className="divide-y divide-slate-100 p-0">
                  {isPrefLoading ? (
                    <div className="p-12 text-center text-slate-500 font-medium">Loading preferences...</div>
                  ) : (
                    <>
                      {/* Master Channels Section */}
                      <div className="p-6 bg-slate-50/20 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-slate-800">Master Switches</h4>
                          <p className="text-xs text-slate-500">Enable or disable delivery methods globally across all alert categories.</p>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="flex items-center gap-2.5">
                            <div className="p-1 bg-[#00786f]/5 text-[#00786f] rounded-lg">
                              <Bell className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-semibold text-slate-600">In-App Globally</span>
                            <Switch
                              checked={preferences.inAppEnabled ?? true}
                              onCheckedChange={(checked) => 
                                updatePreferenceMutation.mutate({ key: 'inAppEnabled', value: checked })
                              }
                            />
                          </div>

                          <div className="flex items-center gap-2.5">
                            <div className="p-1 bg-sky-50 text-sky-600 rounded-lg">
                              <Mail className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-semibold text-slate-600">Email Globally</span>
                            <Switch
                              checked={preferences.emailEnabled ?? true}
                              onCheckedChange={(checked) => 
                                updatePreferenceMutation.mutate({ key: 'emailEnabled', value: checked })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Specific Event Toggles */}
                      {PREFERENCE_MAPPINGS.map((item) => (
                        <div key={item.key} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-slate-50/10 transition-colors">
                          <div className="space-y-1 max-w-md">
                            <span className="text-[10px] font-bold text-[#00786f] uppercase tracking-wider">Channel Configuration</span>
                            <h4 className="text-sm font-bold text-slate-800">{item.label}</h4>
                            <p className="text-xs text-slate-500 leading-normal">{item.description}</p>
                          </div>
                          
                          <div className="flex items-center gap-8">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[11px] font-medium text-slate-500">In-App</span>
                              <Switch
                                checked={preferences[item.inAppKey] ?? true}
                                disabled={!(preferences.inAppEnabled ?? true)}
                                onCheckedChange={(checked) => 
                                  updatePreferenceMutation.mutate({ key: item.inAppKey, value: checked })
                                }
                              />
                            </div>

                            <div className="flex items-center gap-2.5">
                              <span className="text-[11px] font-medium text-slate-500">Email</span>
                              <Switch
                                checked={preferences[item.emailKey] ?? true}
                                disabled={!(preferences.emailEnabled ?? true)}
                                onCheckedChange={(checked) => 
                                  updatePreferenceMutation.mutate({ key: item.emailKey, value: checked })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </div>
    </LayoutWrapper>
  )
}
