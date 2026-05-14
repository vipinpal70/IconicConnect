admin

User:
ID: 1. Name 2. Email 3. Phone Number 4. Address 5. City 6. State 8. Country 9. Lab Name 10. Password

    userType:
        dental lab (client)
        dental lab service (owner)
        <!-- dentist -->

    role:
        dental lab
            client, subuser
        dental lab service (owner)
            QC,Account Manager, Designer, Admin

    11. Plan: Trail, Onboarded -- only for client Optional
        default: Trail

https://orm.drizzle.team/docs/overview

indexes:
multiple index

authentication and authorization security

- token, session management
- in each query usertype+role + access token

Sign-in:
set cookies and access token in the browser

Preference forms:
ID:
clientID:

testing
sign-in
sign-up
reset password

"dev": "next dev --webpack",

click forget password - ui enter email id
check is present in your db - verify button

    - yes
        - enter your new pass
        - re-ener
        submit

admin - register - member - add member - update member - remove member

http://localhost:3000/auth/sign-in

for members and client:
sign-in
forget password / reset password

ema 9,21 oil
9/21 cross - buy

tm -5

addon on above
50 ema

buy only above
sell only below

sign-in:
we will check user
if user is admin then your routues
/admin/dashbord
/api/admin

if user is client then your routues

    /client/dashbord
    /api/client

if user is subuser of a client then your routues
/client/id/subuser --
/api/client/id/subuser/id

if user is qc,designer/account manager
/dashboard
/case
/case/details
/case chat also
/ analytics
