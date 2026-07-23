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

