// Deliberately session-only. This is not evidence of accreditation or a chain transaction.
export type HospitalProfile = { name: string; license: string };
const profiles = new Map<string, HospitalProfile>();
export async function getHospital(address: string): Promise<HospitalProfile | null> {
  return profiles.get(address.toLowerCase()) ?? null;
}
export async function registerHospital(address: string, profile: HospitalProfile): Promise<HospitalProfile> {
  if (!profile.name.trim() || !profile.license.trim()) throw new Error('Enter both hospital details.');
  const saved = { name: profile.name.trim(), license: profile.license.trim() };
  profiles.set(address.toLowerCase(), saved);
  return saved;
}
