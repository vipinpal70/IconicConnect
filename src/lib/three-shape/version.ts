/**
 * Parser version — stamped on every `ThreeShapeCase.source.parserVersion`.
 *
 * Bump policy (xml-work-plan.md §16.1):
 *   PATCH — bug fix that changes NO output for already-correct inputs.
 *   MINOR — additive only: new fields captured, new tooth classes mapped,
 *           new warnings. Old inputs still yield the same category /
 *           subTypeData / teeth, just richer provenance.
 *   MAJOR — a normalisation rule change by which the SAME package could now
 *           produce a different category / subTypeData / teeth (bridge
 *           heuristic, category priority, arch expansion, class remap).
 *           This is the re-import signal.
 *
 * Never lower it. Changelog each bump here.
 *
 * 0.1.0 — initial port.
 * 0.2.0 — added teTemporaryCrownPontic / teProvisional* tooth classes (a
 *         package with those now classifies as Crown & Bridge, not 3D Model —
 *         MAJOR by the policy above, done pre-release); NESTED_ZIP detection;
 *         order-XML size cap 5 MB → 15 MB.
 */
export const PARSER_VERSION = '0.2.0'
