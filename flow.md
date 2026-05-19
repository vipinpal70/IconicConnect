profiles
├── userType: dental_lab
│ ├── role: client ← registers via /auth/sign-up (UI)
│ └── role: subuser ← created by a client via dashboard
│
└── userType: dental_lab_service
├── role: admin ← registers via /api/admin/register (hidden URL)
├── role: qc ← created by admin via /api/admin/register
├── role: account_manager
└── role: designer

admin

- user
  - add admin level user here
- member
  - manage member -add,edit,delete
- client
  - manage client and their profile

sign-up:
only client dental lab will sign-up here
then admin will recevied information of this client
when admin approve then show him to generate login credentials and send an email with these credentails to the client register email

sign-in:
only for client and admin side members



Case Creation
- clinet, subuser of a client,admin as behalf of client , these only can a case report 
- if subuser create a case :
    - get the client id from the subuser
    - get the client name from the subuser
  if admin create a case:
    then admin have to select client name form dropdown 
    then we can create a case

First design a database structure for case management:
then create a api for storing files
then create a api for creating cases 
then create a api for updating cases 
then create a api for deleting cases 
    
and maintaing all the case files for each access level like admin,client,subuser

like admin can do anything
client can see his own cases and subuser cases - they can anything on their cases created by them or subusers
only if their ceated case status if not in progress or completed or qc review etc

subuser can see only his own cases - but he can only upload the files and nothing else

for more information you can refer the frontend code in respect to each roles like admin,client,subuser and qc




case:
  Crown & Bridges
    case-subtypes:
      Case Type:
        Crown
        Bridge
        Cutback
        Coping
        Screw Retained
        In-Lay
        On-Lay

  Denture:
  case-subtypes:
    Case Type 1:
      Reference Denture
      Copy Denture
      Immediate Denture
      Full Denture
      Partial Denture
    case Type 2:
      Lower
      Upper 
      Full Arches

  Cosmetics:
    case-subtypes:
      Case Type:
        Digital Wax Up
        Vineers
        Snap on Smile


  Appliances:
    case-subtypes:
      Case Type 1:
        Night Guards
        Sports Guard
        Mouth Guard
        NTI
      Oclussion:
        even oclussion
        custom
      
      Arch:
        Lower
        Upper 

Implant:
  case-subtypes:
    Case Type 1:
      Robotic
      Custom
      Ti-Base
      
    Case Type 2:
      crown
      bridge
      coping
      screw reatined
      in-lay
      on-lay



i want to write a background script that will cleanup the case_data folder in each 1H 
it will check if a files is stored in the case_data/client folder
but file is not linked with any case created with client
then delete that files


http://localhost:4000/auth/verify?token_hash=d609076ce81bf1e2744ecbb1ec06b66400e3b4a6ab193e64cbfa236e&type=recovery&next=/auth/reset-password

This is the url i am getting on my mail to forgot password but when I click on this url i got redirect to dashboard.
The reset-password page is not opening. Please check why this is happening.
check the proxy.ts file and allow user to reset or forget password even they are logged in or their session is active.
allow /auth/verify route to access
and allow reset-password and forgot-password routes to access 
i am using the supabase for authentication



https://connect.fynback.com/auth/verify?token_hash=7472d8a72342422698a5aee975a58390e4accaebb4f2e4ffa87d7fbb&type=recovery&next=/auth/reset-password

now i am gettting production correctly but when i click on it 
it redirect to the localhost:4000

check for the codebase 
and correct it





Request URL
https://connect.fynback.com/api/cases
Request Method
POST
Status Code
500 Internal Server Error
Remote Address
82.25.108.94:443
Referrer Policy
strict-origin-when-cross-origin

{"category":"Crown & Bridges","subTypeData":{"caseType":"Bridge","modelRequired":"yes","teeth":[1,16],"notes":"special instructions"},"caseNumber":"CAB-6187914911","uploadedFile":{"success":true,"fileUrl":"/api/cases/files?labName=Dandy%20Dental&fileName=notification_triggers_sys3537c7188d0880d1a%20(1).pdf","fileName":"notification_triggers_sys3537c7188d0880d1a (1).pdf","fileSize":104711,"fileType":"application/pdf","storagePath":"Dandy Dental/notification_triggers_sys3537c7188d0880d1a (1).pdf"}}


- Prevent admins from deleting their own account.
  inside the admin/team
  - disable the delete button for self
  - if login user is admin 
  - hide the 

- Add phone number validation.
  - inside the sign-up page
  - inside the admin/team/[id].tsx page
  - job title is set properly, make it work properly

  - only numbers and select country code as +91 
  - i want all countries code and national format number should be like 10 digits in india


- without teeth selection case submit (all field mandatory)
- clear button on filters case page 
  - when user click on clear button
  - it should clear all the filters like status, case type, dates, search text, case number


great, now let work on the case details page 
when user click on the case it should open the case details page 
and show the case details
when user click on the table data, and use click on the row then we will open the case detail page
add this into admin and client both urls 

also i want to show the case files in the case details page 
if there are multiple files then show them in a carousel 
if there is single file then show it in a image viewer 
if there is pdf file then show it in a pdf viewer



inside case details page 
Case Lifecycle ✓ Submitted ✓ In Validation ✓ In Design ✓ Internal QC ✓ Pending Client Approval ✓ Completed
case lifecycle show at the top of case details page , and it should be in green color in horizontal 
so add these case lifecycle states inside the case details page and even in the db as well as 

for ui/ux you can explore the IconicConnect/referanceCode/pages/CaseDetail.tsx

case detail pages fetch timeline events from activity_logs
i want to store these timelines events in the case data db itself
so that each case have its own timeline events