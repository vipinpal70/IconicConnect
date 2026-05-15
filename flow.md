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
