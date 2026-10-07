/** "Instagram + No Website" — shared by the API and the screen (client-safe). */
export const CONTACT_STATUSES = ["not_contacted", "contacted", "replied", "interested", "not_interested", "converted"] as const;
export const FOLLOW_UP_STATUSES = ["none", "scheduled", "due", "done"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const CONTACT_LABEL: Record<ContactStatus, string> = { not_contacted: "Not contacted", contacted: "Contacted", replied: "Replied", interested: "Interested", not_interested: "Not interested", converted: "Converted" };
export const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = { none: "None", scheduled: "Scheduled", due: "Due", done: "Done" };

export interface IgSummaryDTO {
  businessesFound: number; instagramVerified: number; noWebsiteVerified: number; contactable: number; highPotential: number; duplicatesRemoved: number; unverifiedExcluded: number;
  saved: number; noInstagram: number; websiteFound: number;
}
export interface IgLeadDTO {
  id: string; businessName: string; category: string | null; location: string | null; phone: string | null;
  instagramUsername: string; instagramUrl: string; instagramStatus: string; instagramEvidence: string[];
  followers: number | null; posts: number | null; instagramActivity: string | null;
  websiteStatus: string; websiteReasons: string[]; qualityScore: number; highPotential: boolean;
  source: string; foundDate: string; contactStatus: ContactStatus; followUpStatus: FollowUpStatus; followUpAt: string | null; notes: string | null;
}
export interface IgView {
  enabled: boolean; date: string;
  primary: { status: string; verified: number; target: number } | null;
  run: null | { id: string; status: string; target: number; summary: IgSummaryDTO; reasons: string[]; lastError: string | null; startedAt: string; completedAt: string | null; log: { at: string; text: string; tone?: string }[] };
  leads: IgLeadDTO[]; total: number;
  history: { date: string; saved: number; target: number; status: string }[];
}
