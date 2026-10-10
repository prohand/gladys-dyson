# Security policy

## Supported versions

Only the latest release of the Dyson integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version        | Supported |
| -------------- | --------- |
| latest release | Yes       |
| older          | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a
security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-dyson](https://github.com/prohand/gladys-dyson/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- the Dyson model concerned (product type, e.g. `438K`);
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove e-mail addresses, passwords, tokens, serial
  numbers and IP addresses first).

You should get a first answer within 7 days. A fix is released as a new
version of the integration, and the advisory is published once users can
update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular how it handles:

- the MyDyson password and the one-time code (only sent to the Dyson API);
- the Dyson account token and the local MQTT passwords of the devices, kept in
  `/data/dyson-account.json` (owner-only file permissions);
- the MQTT connections to the devices (local) and to the Dyson cloud broker.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)),
the Dyson devices, their firmware, the MyDyson app and the Dyson cloud
services (report to Dyson).

## Good practices for users

- Use a MyDyson password you use nowhere else.
- Keep the Dyson devices on a trusted network (or a dedicated IoT VLAN): the
  local MQTT broker of a device is reachable by anyone on that network who
  knows its local password.
- Use **Sign out** in the integration before uninstalling it, and change the
  MyDyson password if you think the token leaked.
- Keep Gladys and the integration up to date.
