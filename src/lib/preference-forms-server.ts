import { eq } from "drizzle-orm"
import { db } from "@/src/db"
import { preferenceForms } from "@/src/db/schema/preference-form"
import { createPreferenceFormDefaults } from "@/src/lib/preference-forms"

export const DEFAULT_PREFERENCE_FORM_NAME = "Default Preferences"

export async function createSystemDefaultPreferenceForm(clientId: string, createdBy?: string | null) {
  const [existing] = await db
    .select({ id: preferenceForms.id })
    .from(preferenceForms)
    .where(eq(preferenceForms.clientId, clientId))
    .limit(1)

  if (existing) return null

  const [inserted] = await db
    .insert(preferenceForms)
    .values({
      id: crypto.randomUUID(),
      clientId,
      formName: DEFAULT_PREFERENCE_FORM_NAME,
      payload: createPreferenceFormDefaults(),
      createdBy: createdBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  return inserted
}
