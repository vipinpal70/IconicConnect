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