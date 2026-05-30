/**
 * src/lib/pricing.ts
 * Purpose: Frontend-compatible price calculation logic matching PostgreSQL rules.
 * Authors: Antigravity AI
 */

import type {
  CasePricingInput,
  Arch,
  CrownBridgeSubCategory,
  ImplantSubCategory,
  ImplantType,
  ApplianceType,
  OcclusionType,
  DentureSubCategory,
  CosmeticsSubCategory
} from '@/src/types/pricing'

const ARCH_PRICE: Record<Arch, number> = {
  'Upper': 5,
  'Lower': 5,
  'Both Arches': 10,
}

const CB_PRICE: Record<string, number> = {
  Crown: 10,
  Bridge: 10,
}

const APPLIANCE_PRICES: Record<string, Record<string, Record<string, number>>> = {
  'Night Guards': {
    'Even Occlusion': { Upper: 10, Lower: 10, 'Both Arches': 20 },
    'Custom':         { Upper: 15, Lower: 15, 'Both Arches': 25 },
  },
  'Spot Guards': {
    'Even Occlusion': { Upper: 10, Lower: 10, 'Both Arches': 20 },
    'Custom':         { Upper: 15, Lower: 15, 'Both Arches': 25 },
  },
  'Sports Guard': { '_none': { Upper: 10, Lower: 10, 'Both Arches': 20 } },
  'Mouth Guards': { '_none': { Upper: 10, Lower: 10, 'Both Arches': 20 } },
  'NTI':          { '_none': { Upper: 10, Lower: 10, 'Both Arches': 20 } },
}

export function calculateCasePrice(input: CasePricingInput): number {
  switch (input.category) {
    case 'Crown & Bridge':
      return CB_PRICE[input.subCategory] ?? 0

    case 'Implants': {
      const cbKey = input.type === 'On-Lay' ? 'Crown' : input.type
      return 10 + (CB_PRICE[cbKey] ?? 0)
    }

    case 'Appliances': {
      const occKey = input.occlusionType ?? '_none'
      return APPLIANCE_PRICES[input.applianceType]?.[occKey]?.[input.arch] ?? 0
    }

    case 'Dentures':
    case 'Cosmetics':
      return 10 + ARCH_PRICE[input.arch]

    default:
      return 0
  }
}

/**
 * Maps unstructured or semi-structured subTypeData JSON fields from the database
 * to the strict type-safe CasePricingInput model.
 */
export function mapCaseToPricingInput(category: string, subTypeData: any): CasePricingInput | null {
  if (!category) return null

  const normalizedCategory = category.toLowerCase().trim()
  const data = subTypeData || {}

  // 1. Crown & Bridge
  if (normalizedCategory === 'crown & bridge' || normalizedCategory === 'crown & bridges') {
    const subCategory = data.sub_category || data.subCategory || data.caseType || 'Crown'
    const subCatStr = String(subCategory).trim().toLowerCase()
    const finalSubCat: CrownBridgeSubCategory = subCatStr.includes('bridge') ? 'Bridge' : 'Crown'
    
    return {
      category: 'Crown & Bridge',
      subCategory: finalSubCat,
    }
  }

  // 2. Implants
  if (normalizedCategory === 'implant' || normalizedCategory === 'implants') {
    const subCat = data.sub_category || data.subCategory || data.caseType1 || 'Ti-Base'
    const subCatStr = String(subCat).trim().toLowerCase()
    let finalSubCat: ImplantSubCategory = 'Ti-Base'
    if (subCatStr.includes('robotic')) {
      finalSubCat = 'Robotic'
    } else if (subCatStr.includes('custom')) {
      finalSubCat = 'Custom'
    }

    const type = data.type || data.caseType2 || 'Crown'
    const typeStr = String(type).trim().toLowerCase()
    let finalType: ImplantType = 'Crown'
    if (typeStr.includes('bridge')) {
      finalType = 'Bridge'
    } else if (typeStr.includes('on-lay') || typeStr.includes('onlay')) {
      finalType = 'On-Lay'
    }

    return {
      category: 'Implants',
      subCategory: finalSubCat,
      type: finalType,
    }
  }

  // 3. Appliances
  if (normalizedCategory === 'appliances' || normalizedCategory === 'appliance') {
    const appType = data.appliance_type || data.applianceType || data.caseType1 || 'Night Guards'
    const appTypeStr = String(appType).trim().toLowerCase()
    let finalAppType: ApplianceType = 'Night Guards'
    if (appTypeStr.includes('spot')) {
      finalAppType = 'Spot Guards'
    } else if (appTypeStr.includes('sports') || appTypeStr.includes('sport')) {
      finalAppType = 'Sports Guard'
    } else if (appTypeStr.includes('mouth')) {
      finalAppType = 'Mouth Guards'
    } else if (appTypeStr.includes('nti')) {
      finalAppType = 'NTI'
    }

    const occlusion = data.occlusion_type || data.occlusionType || data.occlusion || null
    let finalOcclusion: OcclusionType | undefined = undefined
    if (occlusion) {
      const occStr = String(occlusion).trim().toLowerCase()
      if (occStr.includes('even')) {
        finalOcclusion = 'Even Occlusion'
      } else if (occStr.includes('custom')) {
        finalOcclusion = 'Custom'
      }
    }

    const arch = data.arch || data.caseType2 || 'Upper'
    const archStr = String(arch).trim().toLowerCase()
    let finalArch: Arch = 'Upper'
    if (archStr.includes('lower')) {
      finalArch = 'Lower'
    } else if (archStr.includes('both') || archStr.includes('full')) {
      finalArch = 'Both Arches'
    }

    return {
      category: 'Appliances',
      applianceType: finalAppType,
      occlusionType: finalOcclusion,
      arch: finalArch,
    }
  }

  // 4. Dentures
  if (normalizedCategory === 'denture' || normalizedCategory === 'dentures') {
    const subCat = data.sub_category || data.subCategory || data.caseType1 || 'Full Denture'
    const subCatStr = String(subCat).trim().toLowerCase()
    let finalSubCat: DentureSubCategory = 'Full Denture'
    if (subCatStr.includes('reference')) {
      finalSubCat = 'Reference Denture'
    } else if (subCatStr.includes('copy')) {
      finalSubCat = 'Copy Denture'
    } else if (subCatStr.includes('immediate')) {
      finalSubCat = 'Immediate Denture'
    } else if (subCatStr.includes('partial')) {
      finalSubCat = 'Partial Denture'
    }

    const arch = data.arch || data.caseType2 || 'Upper'
    const archStr = String(arch).trim().toLowerCase()
    let finalArch: Arch = 'Upper'
    if (archStr.includes('lower')) {
      finalArch = 'Lower'
    } else if (archStr.includes('both') || archStr.includes('full')) {
      finalArch = 'Both Arches'
    }

    return {
      category: 'Dentures',
      subCategory: finalSubCat,
      arch: finalArch,
    }
  }

  // 5. Cosmetics
  if (normalizedCategory === 'cosmetics' || normalizedCategory === 'cosmetic') {
    const subCat = data.sub_category || data.subCategory || data.caseType1 || 'Veneers'
    const subCatStr = String(subCat).trim().toLowerCase()
    let finalSubCat: CosmeticsSubCategory = 'Veneers'
    if (subCatStr.includes('digital') || subCatStr.includes('wax')) {
      finalSubCat = 'Digital Wax Up'
    } else if (subCatStr.includes('snap')) {
      finalSubCat = 'Snap on Smile'
    }

    const arch = data.arch || data.caseType2 || 'Upper'
    const archStr = String(arch).trim().toLowerCase()
    let finalArch: Arch = 'Upper'
    if (archStr.includes('lower')) {
      finalArch = 'Lower'
    } else if (archStr.includes('both') || archStr.includes('full')) {
      finalArch = 'Both Arches'
    }

    return {
      category: 'Cosmetics',
      subCategory: finalSubCat,
      arch: finalArch,
    }
  }

  return null
}
