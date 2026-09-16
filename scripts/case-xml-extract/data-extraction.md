3Shape DentalContainer XML
Deep Extraction & Import Specification
Category • Sub-category • Tooth Selection • Patient • Order • Material • Manufacturing • Scans • Attachments • Validation • Import Mapping

Prepared from the uploaded 3Shape DentalContainer XML examples and the observed schema/mapping requirements.

1. Executive Summary
A 3Shape DentalContainer XML is substantially richer than a simple order form. The examples show a hierarchical container with order data, model jobs, model elements, tooth elements, links between elements, scans, custom data, exchange attachments, and many optional domain-specific lists. A production importer should therefore parse the XML into a normalized internal representation first, then map that representation into the application's case schema.
The most important rule established from the sample files is: use ToothElementList as the authoritative source for actual tooth selection and dental element classification. Do not parse the numeric suffix in OrderList.Items as the tooth number. For example, the Mervin Heth file says Items='Anatomy bridge 24-26', while the actual ToothNumber values are 14, 12 and 13. The Natasha Thompson file says 'Anatomy bridge 37-35', while the ToothNumber values are 19, 20 and 18. fileciteturn11file0L15-L64 fileciteturn11file2L476-L525
The importer should preserve both representations: the human/order text exactly as supplied and the structured tooth hierarchy separately. This avoids silently changing source data when the two disagree.
2. What the XML Can Give You
Area
XML source
Extraction quality
Recommended use
Patient
OrderList / Patient_*
Direct
Patient name, reference number, source PatientGuid
Case/order ID
IntOrderID / NumOrderID / ExtOrderID
Direct
External/source identifiers
Client
ClientID / Customer / ClientContactPerson
Direct
Resolve source client to internal profile
Category
ToothElement CacheToothTypeClass + order/model context
Structured + normalized
Crown, Abutment, Splint, Bridge, etc.
Sub-category
toothElementTypeID
Direct source ID
Store raw ID; optionally map to friendly name
Tooth selection
ToothNumber
Direct
Authoritative selected teeth
Material
CacheMaterialName / MaterialID
Direct
Material requested/used
Color
CacheColor / ColorID
Direct when populated
Shade/color metadata
Manufacturer
ManufName / ManufacturerID
Direct
Manufacturing provider/source manufacturer
Manufacturing process
ManufacturingProcessID
Direct ID
Store raw ID; resolve via reference data if available
Model file
ModelFilename
Direct path
CAD/model input reference
Model geometry
ModelHeight, ModelVolume, BoundingBox*
Direct
QA/analytics/diagnostics
Validation
ValidationResult
Direct
Import/QA metadata
Scans
ScanList
Direct
Preparation, antagonist, generic pre-prep, etc.
Attachments
OrderExchangeAttachmentList
Direct path
Screenshots and related files
Custom metadata
CustomDataList
Direct key/value
Version, source app, UUID and future extension
Relationships
LinkList / LinkToothElementList
Direct
Bridge/connector relationships
Dates
CreateDate / DeliveryDate / ShippingDate / ReceiveDate / ScanDate
Direct epoch
Timeline/requested dates; convert carefully
Workflow status
ProcessStatusID / AltProcessStatusID
Direct source status
Source status only; do not equate to app status
3. XML Architecture
Observed top-level structure:
DentalContainer
└── Object MainObject (TDM_Container)
    ├── OrderList
    ├── ModelJobList
    ├── ModelElementList
    ├── ToothElementList
    ├── LinkList
    ├── LinkToothElementList
    ├── SplitBridgeLinkList
    ├── MaterialList
    ├── ManufacturingProcessList
    ├── ToothElementTypeList
    ├── ScanList
    ├── CustomDataList
    ├── OrderExchangeElementList
    ├── OrderExchangeAttachmentList
    ├── DigitalModelElementInfoList
    ├── MarginLineList
    ├── Implant / Abutment / Articulator / Overlay lists
    └── import-control properties
The XML uses repeated Object/List/Property structures. A robust parser should not depend on a fixed ordering of objects. It should locate objects by their name/type and properties by the Property@name attribute.
4. Category Extraction — Most Important Rule
4.1 Authoritative dental classification
For each TDM_Item_ToothElement, extract CacheToothTypeClass. This is the structured dental element class. Examples observed in the uploaded XMLs include teCrown and teCrownPontic. Other previously inspected files also contained teAbutment and teSplint.
Raw XML value
Normalized category
Meaning in importer
teCrown
Crown
Crown element
teAbutment
Abutment
Abutment element
teSplint
Splint
Splint case/element
teCrownPontic
Crown Pontic
Pontic element within a bridge
Normalization should be implemented as a mapping table rather than hard-coded assumptions scattered throughout the code.
TOOTH_CLASS_MAP = {
    "teCrown": "Crown",
    "teAbutment": "Abutment",
    "teSplint": "Splint",
    "teCrownPontic": "Crown Pontic",
}
4.2 Bridge detection
A bridge is not represented in the samples simply as one CacheToothTypeClass='Bridge'. In the bridge examples, multiple tooth elements are linked under one ModelElement and the tooth classes include crowns and a pontic. The order text also explicitly says 'Anatomy bridge ...'. Therefore bridge should be treated as a normalized case-level category derived from the structured elements plus order/model context, while preserving every raw element.
Mervin Heth: the order/model item is 'Anatomy bridge 24-26', while the ToothElementList contains tooth 14 crown, tooth 12 crown, and tooth 13 crown pontic. fileciteturn11file0L75-L118 fileciteturn11file0L121-L154
Natasha Thompson: the order/model item is 'Anatomy bridge 37-35', while the structured teeth are 19 pontic, 20 crown and 18 crown. fileciteturn11file2L537-L580 fileciteturn11file2L583-L616
5. Sub-category / Tooth Element Type
The property toothElementTypeID is the best source for the raw sub-type identifier. Examples include 'Configuration_11_IDCrownZircon10' for crown elements and '43792_ToothElementType00' for pontics. For splint files, 'Splint1' was observed.
Field
Example
Store as
Do not do
toothElementTypeID
Configuration_11_IDCrownZircon10
raw subtype ID
Do not assume ID is a tooth number
toothElementTypeID
43792_ToothElementType00
raw subtype ID
Do not convert numeric fragments to teeth
toothElementTypeID
Splint1
raw subtype ID
Do not infer a universal naming standard
If the XML contains a populated ToothElementTypeList in another case, use it as a reference table to resolve friendly subtype names. In the supplied examples that list is empty, so a friendly subtype name cannot be reliably invented from the ID alone.
6. Tooth Selection
The actual selected tooth is ToothElementList/Object/Property[@name='ToothNumber']. Each tooth element also carries a ToothElementID and ModelElementID, which lets the importer retain relationships.
ToothElement property
Purpose
ToothElementID
Unique identifier for the tooth-level element
ModelElementID
Connects tooth element to the parent model element
toothElementTypeID
Subtype/type identifier
ToothNumber
Actual selected tooth number
AbutmentKitID
Abutment kit reference when populated
Anatomical
Boolean source flag
PostAndCore
Boolean source flag
CacheToothTypeClass
Structured dental class
Example: Mervin Heth has ToothNumber 14 and 12 for teCrown and 13 for teCrownPontic. These are the values to import into the application's tooth selection, not the 24-26 text from OrderList.Items. fileciteturn11file0L121-L154
7. Patient Information
XML property
Observed meaning
Internal handling
Patient_FirstName
Patient first name
Trim; preserve empty as null
Patient_LastName
Patient last name; sometimes full name in samples
Preserve source; optionally split only if explicitly valid
Patient_RefNo
Patient reference number
Store as source patient reference
PatientGuid
Source patient GUID when provided
Store source GUID separately
The samples show Patient_FirstName often empty and Patient_LastName containing the full displayed name, e.g. Mervin Heth, Brenda Strickland and Natasha Thompson. Therefore the importer must not assume LastName contains only a surname. fileciteturn11file0L21-L28 fileciteturn11file1L252-L259 fileciteturn11file2L483-L490
8. Order / Client / Operator Information
XML property
Can extract
Recommended internal field
IntOrderID
Source string order ID
sourceOrderId
NumOrderID
Numeric source order ID
sourceNumericOrderId
ExtOrderID
External order ID
sourceExternalOrderId
ImportOrderID
Import-specific source ID
sourceImportOrderId
ClientID
Source client identifier
sourceClientId
ClientOrderNo
Client's order number
clientOrderNo
ClientContactPerson
Contact person
clientContactPerson
Customer
Customer/lab display value
customerName
ManufName
Manufacturer/lab display value
manufacturerName
OperatorName
Operator name
operatorName
OperatorID
When available in a variant
sourceOperatorId
OrderComments
Free-text instructions
clientMassage / comments
OrderImportanceID
Order priority class
sourceOrderImportance
The Mervin file demonstrates the relationship: IntOrderID, NumOrderID and ClientID are in OrderList, while Customer, ManufName, OperatorName, CacheMaterialName and ScanSource are also available at order level. fileciteturn11file0L15-L64
9. Material, Manufacturer & Manufacturing
Material information exists at multiple levels. CacheMaterialName is human-readable in the sample files; MaterialID is a source identifier. ManufacturingProcessID and ManufacturerID provide additional machine/reference identifiers.
XML field
Example
Recommended storage
CacheMaterialName
Zirkon
materialName
MaterialID
Configuration_11_Material1
materialId
CacheColor
1M1 / empty
colorName
ColorID
source color ID
colorId
ManufName
JDE CROWN DENTAL STUDIO
manufacturerName
ManufacturerID
17929
manufacturerId
ManufacturingProcessID
Configuration_06_Prc02
manufacturingProcessId
ModelManufacturingID
source ID when populated
modelManufacturingId
CAMBlankID / BatchID
source CAM IDs
CAM metadata
CAMJobID / CAMJobName
source CAM job
CAM metadata
Mervin and Brenda both show material Zirkon, MaterialID Configuration_11_Material1, ManufacturingProcessID Configuration_06_Prc02, ManufacturerID 17929, and validation vrPassed. fileciteturn11file0L75-L118 fileciteturn11file1L306-L349
10. Model Geometry & CAD Metadata
Property
Use
ModelFilename
CAD/model file reference
ModelHeight
Geometry measurement
ModelVolume
Geometry measurement
ModelBoundingBoxMin
3D bounding-box minimum coordinates
ModelBoundingBoxMax
3D bounding-box maximum coordinates
ModelTransformation
Transformation metadata when populated
Location1-4
Model/location metadata when populated
VirtualItem
Boolean virtual model flag
ModelComment
Model-level comment
ModelActive
Active model flag
WasSent
Source sent-state flag
The model filename is an input/model reference, not proof that it is the final delivered output. For example, Mervin has a CAD path ending in '...Mervin_Heth 0.dcm'. fileciteturn11file0L75-L118
11. Source Workflow / Application Metadata
XML field
Example
Meaning for importer
DentalContainer@version
2022-1
Container format/version
CreatedFromApp
appDentalDesigner
Source application
DesignModuleID
DentalDesigner
Design module
ModelDesignModule
mdmModelBuilder
Model builder module
ScanModuleID
ScanItRestoration
Scan module
ScanSource
ss3SE4
Source of scan data
FaceScanModuleID
empty in samples
Optional face scan module
ModelBuilderExpressPresetGUID
optional
Preset identifier
ModelBuilderExpressPresetDisplayName
optional
Preset display name
These fields are useful for analytics, routing, importer diagnostics and source compatibility. They should generally be retained as source metadata rather than being used as direct replacements for your application's workflow fields.
12. Scans
ScanList provides scan-level records. The samples contain scan types such as stPreperation, stAntagonistModel and stGenericPrePrep. Each scan has ScanID, ModelJobID, optional ModelElementID/ToothElementID, ScanDate, ScanName and FileName.
Scan property
Purpose
ScanID
Unique source scan identifier
ScanType
Type/class of scan
ModelJobID
Connect scan to model job
ModelElementID
Optional model-element relationship
ToothElementID
Optional tooth-element relationship
ScanDate
Source scan timestamp
ScanName
Optional scan name
FileName
Optional scan file reference
Brenda contains antagonist, preparation and generic pre-prep scans; Natasha contains preparation and antagonist scans. fileciteturn12file1L358-L390 fileciteturn12file2L693-L716
13. Custom Data
CustomDataList is a flexible key/value extension mechanism. Each entry contains CustomDataID, OrderID, FieldID, FieldCaption, Value and Kind. The observed samples include ScanItDental, a source/internal version such as 2.22.2.0, and a public UUID. fileciteturn12file0L66-L92
Field
Example
Recommendation
FieldID
{4567...}
Preserve raw key
Value
ScanItDental
Preserve raw value
Kind
cdkPublic
Preserve visibility/type
FieldCaption
empty
Preserve when populated
14. Attachments / Screenshots
OrderExchangeElementList describes an exchange element, while OrderExchangeAttachmentList identifies the files attached to it. The samples include six image screenshots: Top.jpg, Bottom.jpg, Front.jpg, Back.jpg, Left.jpg and Right.jpg.
Attachment field
Purpose
OrderExchangeAttachmentID
Source attachment ID
OrderExchangeAttachmentExtID
External attachment ID
OrderExchangeElementID
Parent exchange element
Name
Filename
Path
Source-relative path
AttachmentType
e.g. Image
The Mervin sample explicitly maps names such as Bottom.jpg and Front.jpg to 3SCom\Screenshots paths. fileciteturn12file0L94-L163
15. Links and Bridge Relationships
LinkList and LinkToothElementList provide relationship data. A Link has LinkID, LinkTypeID, ModelElementID and CacheLinkTypeClass. LinkToothElement connects a LinkID to ToothElementID.
In the Mervin example, connector links connect the crown/pontic tooth elements under the model element. This relationship information is valuable when reconstructing bridge topology rather than treating the case as an unordered list of teeth. fileciteturn11file0L155-L193
16. Dates & Timestamps
XML property
Interpretation
Caution
CreateDate
Source creation timestamp
Unix epoch; convert to timezone-aware datetime
DeliveryDate
Source delivery/request date
Do not treat as proof of delivery
ShippingDate
Source shipping timestamp
Source event only
ReceiveDate
Source receive timestamp
Source event only
ScanDate
Scan timestamp
Source scan event
CreateTimeStamp
Exchange element creation
Source exchange event
SyncTimeStamp
Exchange sync event
0 means not populated in samples
ApproveTimeStamp
Exchange approval event
0 means not populated in samples
For example, Mervin's ModelElement has CreateDate, DeliveryDate, ShippingDate and ReceiveDate as numeric epoch values. fileciteturn11file0L99-L105
17. Validation & Processing Status
ModelElementList contains ProcessStatusID, AltProcessStatusID, ProcessLockID and ValidationResult. These are useful source-system states. They should not be blindly mapped to application workflow states.
Source field
Example
Recommended treatment
ProcessStatusID
psModelled
sourceProcessStatus
AltProcessStatusID
psModelled
sourceAltProcessStatus
ProcessLockID
plReady
sourceProcessLock
ValidationResult
vrPassed
sourceValidation
CAMErrorDescription
empty
source CAM diagnostic
Your application status such as scan_received, in_design, qc, delivered, etc. should be determined by importer/business workflow rules rather than equating psModelled to an application status.
18. Import Mapping to Your Cases Schema
Cases column
XML source
Mapping
clientId
ClientID
Resolve source client ID to internal profile UUID
subuserId
ClientContactPerson / source user mapping
Only if your business rules identify a subuser
createdBy
OperatorName
Optional source operator; do not assume creator identity
caseNumber
IntOrderID / NumOrderID
Prefer storing source IDs separately; use app case-number policy
category
ToothElementList + context
Normalized category
subTypeData
All structured extraction
JSONB source-preserving object
status
Application workflow
Do not directly map psModelled
serviceType
No reliable direct field in samples
Business rule / manual mapping
clientMassage
OrderComments
Direct
approvalChecklist
Not observed
Default []
designerId
Source operator mapping if applicable
Resolve to internal UUID
qcId
Not directly supplied
Null
accountManagerId
Not directly supplied
Null
autoApproved
Not supplied
Default false
submittedToClientAt
Not directly supplied
Null unless exchange event/business rule maps it
startTime
Not directly supplied
Business workflow
deliveredTime
Not proofed by DeliveryDate
Do not infer
tat
Not directly supplied
Calculate in application
dueDate
DeliveryDate
Only if business semantics confirm requested due date
timeline
Source timestamps + importer events
Construct application timeline
outputFile
Not directly supplied
Null until output is actually stored
previewFile
Not directly supplied
Can be populated from imported screenshot workflow
outputNote
Not directly supplied
Null
preferredTeethLibrary
Not supplied
Default
teethLibraryFileUrl
Not supplied
Null
teethLibraryFileName
Not supplied
Null
19. Recommended Internal JSON
{
  "source": "3shape",
  "containerVersion": "2022-1",
  "sourceOrderId": "17929_20260727_1859_Tech_01_Mervin_Heth",
  "sourceNumericOrderId": "1792912845684",
  "sourceClientId": "17929",

  "patient": {
    "refNo": null,
    "firstName": null,
    "lastName": "Mervin Heth",
    "sourcePatientGuid": null
  },

  "order": {
    "clientOrderNo": null,
    "contactPerson": null,
    "importance": "oiNormal",
    "customer": "2132095220_JDE CROWN DENTAL STUDIO",
    "manufacturer": "2132095220_JDE CROWN DENTAL STUDIO",
    "operator": "Tech 01",
    "comments": "",
    "createdFromApp": "appDentalDesigner",
    "designModule": "DentalDesigner",
    "modelDesignModule": "mdmModelBuilder",
    "scanModule": "ScanItRestoration",
    "scanSource": "ss3SE4",
    "itemsRaw": "Anatomy bridge 24-26"
  },

  "classification": {
    "category": "Bridge",
    "subTypes": [
      "Configuration_11_IDCrownZircon10",
      "43792_ToothElementType00"
    ],
    "toothNumbers": [12, 13, 14]
  },

  "elements": [
    {
      "toothElementId": "TE...",
      "modelElementId": "ME...",
      "toothElementTypeId": "Configuration_11_IDCrownZircon10",
      "toothNumber": 14,
      "toothClass": "teCrown",
      "anatomical": false,
      "postAndCore": false,
      "abutmentKitId": null
    }
  ],

  "model": {
    "modelJobId": "MJ...",
    "modelElementId": "ME...",
    "materialId": "Configuration_11_Material1",
    "materialName": "Zirkon",
    "colorId": null,
    "colorName": "",
    "manufacturerId": "17929",
    "manufacturingProcessId": "Configuration_06_Prc02",
    "processStatus": "psModelled",
    "validationResult": "vrPassed",
    "modelFilename": "CAD\\...dcm",
    "height": 8.975154,
    "volume": 764.4755
  },

  "scans": [],
  "attachments": [],
  "customData": [],
  "relationships": {
    "links": [],
    "linkToothElements": []
  },

  "raw": {
    "preserveSourceValues": true
  }
}
20. Python XML Parsing Strategy
Use Python's standard xml.etree.ElementTree for the basic parser. The key design is a small helper that extracts Property@value by property name, followed by explicit parsers for each logical list.
from xml.etree import ElementTree as ET

def prop(obj, name, default=None):
    for p in obj.findall("./Property"):
        if p.get("name") == name:
            return p.get("value", default)
    return default

root = ET.parse(xml_path).getroot()

order_obj = root.find(".//Object[@name='OrderList']//Object")
order = {
    "intOrderId": prop(order_obj, "IntOrderID"),
    "numOrderId": prop(order_obj, "NumOrderID"),
    "clientId": prop(order_obj, "ClientID"),
    "patientFirstName": prop(order_obj, "Patient_FirstName"),
    "patientLastName": prop(order_obj, "Patient_LastName"),
    "comments": prop(order_obj, "OrderComments"),
    "customer": prop(order_obj, "Customer"),
    "operator": prop(order_obj, "OperatorName"),
    "itemsRaw": prop(order_obj, "Items"),
}

tooth_elements = []
for obj in root.findall(".//Object[@type='TDM_Item_ToothElement']"):
    tooth_elements.append({
        "id": prop(obj, "ToothElementID"),
        "modelElementId": prop(obj, "ModelElementID"),
        "typeId": prop(obj, "toothElementTypeID"),
        "toothNumber": int(prop(obj, "ToothNumber")),
        "abutmentKitId": prop(obj, "AbutmentKitID"),
        "anatomical": prop(obj, "Anatomical") == "True",
        "postAndCore": prop(obj, "PostAndCore") == "True",
        "toothClass": prop(obj, "CacheToothTypeClass"),
    })
21. Category Normalization Algorithm
def normalize_category(elements, items_raw):
    classes = {e["toothClass"] for e in elements if e.get("toothClass")}
    items = (items_raw or "").lower()

    if "splint" in items or "teSplint" in classes:
        return "Splint"

    if "teAbutment" in classes and "teCrown" in classes:
        return "Implant Crown + Abutment"

    if "teCrownPontic" in classes and len(elements) >= 3:
        return "Bridge"

    if "bridge" in items and len(elements) >= 2:
        return "Bridge"

    if "teAbutment" in classes:
        return "Abutment"

    if "teCrown" in classes:
        return "Crown"

    if classes:
        return sorted(classes)[0]

    return "Unknown"
Important: this is a normalization policy, not a claim that 3Shape itself defines the application category exactly this way. Keep the raw classes and raw Items text so the policy can be changed without reparsing the original XML.
22. Linking Model Elements to Teeth
model_elements = {}
for obj in root.findall(".//Object[@type='TDM_Item_ModelElement']"):
    model_elements[prop(obj, "ModelElementID")] = {
        "modelJobId": prop(obj, "ModelJobID"),
        "materialId": prop(obj, "MaterialID"),
        "materialName": prop(obj, "CacheMaterialName"),
        "colorId": prop(obj, "ColorID"),
        "manufacturerId": prop(obj, "ManufacturerID"),
        "manufacturingProcessId": prop(obj, "ManufacturingProcessID"),
        "modelFilename": prop(obj, "ModelFilename"),
        "processStatus": prop(obj, "ProcessStatusID"),
        "validation": prop(obj, "ValidationResult"),
    }

for tooth in tooth_elements:
    tooth["model"] = model_elements.get(tooth["modelElementId"])
23. Relationship Graph
Order
  │
  ├── ModelJob
  │     │
  │     ├── ModelElement
  │     │       │
  │     │       └── ToothElement(s)
  │     │
  │     └── Scan(s)
  │
  ├── CustomData
  │
  └── OrderExchangeElement
          │
          └── Attachment(s)

Link
  │
  └── LinkToothElement → ToothElement
This graph is important because a case should not be flattened too early. The same model element can contain multiple tooth elements, and links can describe how those tooth elements relate.
24. Data Quality Rules / Import Guardrails
    • Never derive ToothNumber from OrderList.Items. Use ToothElementList.ToothNumber.
    • Never overwrite raw source IDs with friendly names; store both raw and normalized values.
    • Never assume Patient_LastName contains only a surname; preserve the original source string.
    • Do not map source ProcessStatusID directly to the application's case status.
    • Do not treat DeliveryDate as proof that the case was delivered.
    • Do not treat ModelFilename as the final output file.
    • Do not assume serviceType is explicitly present in the XML; establish a business rule.
    • Resolve ClientID and other numeric/string source identifiers to internal UUIDs through a mapping table.
    • Preserve OrderComments verbatim before applying any normalization.
    • Preserve all unknown CustomData entries so future XML variants do not cause data loss.
    • Treat missing optional lists as valid; many lists are empty in the sample files.
    • Version the parser by DentalContainer version and keep a raw XML import record for reprocessing.
25. Suggested Database Design for the Import Layer
Table
Purpose
cases
Application-level case record
case_imports
One row per imported XML/container, source hash, version, parser version, status
case_source_orders
Source order IDs and original order metadata
case_tooth_elements
One row per ToothElement with raw class/type/tooth number
case_model_elements
Material/manufacturing/model metadata
case_scans
Scan records
case_attachments
Imported exchange attachments
case_source_custom_data
Raw CustomData entries
case_relationships
Links and bridge/topology relationships
This is preferable to placing every source field into the cases table. The cases table should contain business-level fields; the import tables preserve source-system fidelity and make the importer auditable.
26. Recommended subTypeData JSONB Contract
{
  "source": "3shape",
  "containerVersion": "2022-1",
  "sourceOrderId": "...",
  "sourceClientId": "...",
  "order": {
    "numericOrderId": "...",
    "customer": "...",
    "operator": "...",
    "comments": "...",
    "createdFromApp": "...",
    "designModule": "...",
    "scanModule": "...",
    "scanSource": "..."
  },
  "classification": {
    "category": "Bridge",
    "rawToothClasses": ["teCrown", "teCrownPontic"],
    "subtypes": ["..."],
    "toothNumbers": [12, 13, 14]
  },
  "elements": [],
  "models": [],
  "scans": [],
  "attachments": [],
  "customData": [],
  "relationships": [],
  "rawSource": {
    "items": "Anatomy bridge 24-26"
  }
}
27. Example: Mervin Heth Extraction
Field
Extracted value
Patient
Mervin Heth
IntOrderID
17929_20260727_1859_Tech_01_Mervin_Heth
NumOrderID
1792912845684
ClientID
17929
Order Items
Anatomy bridge 24-26
Operator
Tech 01
Material
Zirkon
Category
Bridge (normalized)
Tooth 12
teCrown / Configuration_11_IDCrownZircon10
Tooth 13
teCrownPontic / 43792_ToothElementType00
Tooth 14
teCrown / Configuration_11_IDCrownZircon10
Validation
vrPassed
Model
CAD\17929_20260727_1859_Tech_01_Mervin_Heth 0.dcm
Scans
stAntagonistModel, stPreperation
Screenshots
Bottom, Front, Left, Right, Back, Top
Source evidence: Mervin source: Order and model metadata fileciteturn11file0L15-L118; tooth hierarchy fileciteturn11file0L121-L154; scans/custom data/attachments fileciteturn12file0L33-L163.
28. Example: Brenda Strickland Extraction
Field
Extracted value
Patient
Brenda Strickland
IntOrderID
17929_20260729_1759_Tech_01_Brenda_Strickland
Items
Anatomy bridge 24-26
Operator
Tech 01
Material
Zirkon
Tooth 12
teCrown
Tooth 13
teCrownPontic
Tooth 14
teCrown
Category
Bridge (normalized)
Scans
stAntagonistModel, stPreperation, stGenericPrePrep
Validation
vrPassed
Source evidence: Brenda source: order metadata fileciteturn11file1L245-L294; model metadata fileciteturn11file1L306-L349; tooth hierarchy fileciteturn11file1L352-L385; scans fileciteturn12file1L358-L390.
29. Example: Natasha Thompson Extraction
Field
Extracted value
Patient
Natasha Thompson
IntOrderID
17929_20260728_1628_Tech_01_Natasha_Thompson
Items
Anatomy bridge 37-35
Operator
Tech 01
Material
Zirkon
Tooth 18
teCrown
Tooth 19
teCrownPontic
Tooth 20
teCrown
Category
Bridge (normalized)
Scans
stPreperation, stAntagonistModel
Validation
vrPassed
Source evidence: Natasha source: order metadata fileciteturn11file2L476-L525; model and tooth hierarchy fileciteturn11file2L537-L616; scans fileciteturn12file2L693-L716.
30. Fields We Should NOT Invent
Application field
Why it should not be invented from XML alone
serviceType
No reliable direct source field in the supplied examples
designerId
Operator/source ID is not automatically an internal UUID
qcId
No QC assignment field observed
accountManagerId
No account manager field observed
autoApproved
No source approval flag observed
deliveredTime
DeliveryDate is not proof of actual delivery
outputFile
ModelFilename is not necessarily output
previewFile
Screenshots can be imported, but preview semantics are application-specific
tat
Requires application timestamps/business rules
preferredTeethLibrary
Not present in the supplied XML
31. Production Import Pipeline
1. Receive XML/container
2. Validate XML syntax
3. Identify DentalContainer version
4. Compute source checksum
5. Parse OrderList
6. Parse ModelJobList
7. Parse ModelElementList
8. Parse ToothElementList
9. Parse LinkList + LinkToothElementList
10. Parse ScanList
11. Parse CustomDataList
12. Parse OrderExchangeElement/Attachment lists
13. Resolve source IDs against internal mappings
14. Normalize category/subtype
15. Validate tooth relationships
16. Detect source/order-text discrepancies
17. Build import DTO
18. Persist source/import audit row
19. Create/update application case
20. Attach source files/screenshots
21. Emit importer warnings
22. Mark import complete / failed
32. Recommended Import Warnings
    • ORDER_ITEM_TOOTH_MISMATCH — Order Items text contains tooth-like numbers that differ from ToothNumber.
    • PATIENT_NAME_PARTIAL — FirstName empty while LastName contains a full display name.
    • CLIENT_MAPPING_MISSING — ClientID could not be mapped to an internal profile.
    • UNKNOWN_TOOTH_CLASS — CacheToothTypeClass not in the current normalization map.
    • UNKNOWN_SUBTYPE — toothElementTypeID has no friendly lookup.
    • MODEL_FILE_NOT_FOUND — XML references a model path that is not present in the container/package.
    • ATTACHMENT_FILE_NOT_FOUND — attachment path is listed but file is absent.
    • SOURCE_STATUS_UNMAPPED — ProcessStatusID has no application workflow mapping.
    • DUE_DATE_AMBIGUOUS — DeliveryDate semantics have not been configured for the business workflow.
    • DUPLICATE_SOURCE_ORDER — same source order/checksum has already been imported.
33. Final Recommended Extraction Contract
For every imported 3Shape XML, the importer should produce five layers of data:
Layer
Contents
1. Source identity
container version, IntOrderID, NumOrderID, ClientID, source UUIDs
2. Patient/order
patient fields, customer, operator, comments, order items, source modules
3. Dental structure
category, raw tooth classes, subtype IDs, tooth numbers, abutment flags
4. Manufacturing/model
material, color, manufacturer, process, validation, model file, geometry
5. Supporting data
scans, links, custom data, screenshots/attachments, timestamps
This design gives the application both a clean business representation and a lossless source representation. The clean representation can drive UI, pricing, workflow and search; the source representation allows auditing, debugging and future parser improvements without asking the client to resend the XML.
34. One-Page Developer Cheat Sheet
Need
Read this XML path/property
Patient name
OrderList → TDM_Item_Order → Patient_FirstName / Patient_LastName
Patient reference
OrderList → Patient_RefNo
Source patient GUID
OrderList → PatientGuid
Case/source order ID
OrderList → IntOrderID / NumOrderID
Client
OrderList → ClientID / Customer
Order comments
OrderList → OrderComments
Order item text
OrderList → Items
Category/class
ToothElementList → CacheToothTypeClass
Sub-category
ToothElementList → toothElementTypeID
Actual tooth
ToothElementList → ToothNumber
Tooth-level flags
ToothElementList → Anatomical / PostAndCore / AbutmentKitID
Model
ModelElementList → ModelElementID / ModelJobID / ModelFilename
Material
ModelElementList → MaterialID / CacheMaterialName
Manufacturer
ModelElementList → ManufacturerID / ManufName
Manufacturing process
ModelElementList → ManufacturingProcessID
Validation
ModelElementList → ValidationResult
Geometry
ModelElementList → ModelHeight / ModelVolume / BoundingBox
Scans
ScanList → ScanType / ScanDate / FileName
Links
LinkList + LinkToothElementList
Custom metadata
CustomDataList → FieldID / Value / Kind
Screenshots
OrderExchangeAttachmentList → Name / Path / AttachmentType
Source timestamps
CreateDate / DeliveryDate / ShippingDate / ReceiveDate
35. Conclusion
The 3Shape DentalContainer XML should be treated as a structured source package, not as a text string to regex for a few values. The strongest extraction strategy is to parse the XML object graph, retain raw source identifiers, construct normalized dental elements, and only then map those elements into the application's case model.
The single most important implementation decision is to make ToothElementList the authoritative source for tooth selection and tooth classification, while retaining OrderList.Items as raw order text. The supplied files repeatedly demonstrate that those two representations can disagree. This approach prevents incorrect tooth assignment and gives your importer a durable foundation for crowns, abutments, splints, bridges and future 3Shape variants.


