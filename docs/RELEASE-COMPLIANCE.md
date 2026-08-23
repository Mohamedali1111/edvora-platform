# Release Compliance

Store compliance is a permanent engineering requirement for Edvora, not a final checklist pasted on at launch. This document is a baseline and does not guarantee Apple App Store or Google Play approval.

## V1 Payment Position

The student app has no digital content purchase flow in V1. There is no in-app payment, course purchase, checkout, subscription purchase, Stripe, Paymob, or equivalent student payment flow in V1.

Instructor SaaS billing is handled externally and manually outside the student mobile application.

## Apple App Store Considerations

Future iOS releases must account for:

- A privacy policy.
- Accurate privacy disclosures.
- Account deletion support when account creation exists.
- Reviewer/demo access for authenticated app areas.
- Minimal permissions.
- SDK privacy manifests and third-party SDK data collection review.
- Complete and stable app behavior at submission.
- Copyright and content rights for educational materials.
- Native security functionality implemented only with supported public APIs.
- No reliance on unsupported/private iOS APIs.
- Authentication decisions compatible with Apple policies.
- No student digital content purchase flow in V1.

## Google Play Considerations

Future Android releases must account for:

- Accurate Data Safety disclosures.
- Account deletion requirements when account creation exists.
- App Access/reviewer account requirements for authenticated app areas.
- Minimal sensitive permissions.
- SDK and data collection awareness.
- Accurate store metadata.
- Stable production build behavior.
- Copyright and content rights for educational materials.
- No student digital content purchase flow in V1.

## Privacy and Data Handling

The platform should collect only data needed for product, security, compliance, and support purposes. Sensitive authentication material must not be logged. Third-party SDKs must be reviewed for data collection and policy implications before adoption.

## Account Deletion

When account creation exists, release planning must include a compliant account deletion path or documented process consistent with store requirements and business/legal constraints.

## Reviewer Access

Authenticated applications must provide reviewer/demo access or other approved review paths so Apple and Google reviewers can evaluate protected areas.

## Permissions

Apps should request the minimum permissions required for their actual functionality. Permission prompts should be understandable and tied to user value.

## SDK Review

Every mobile SDK must be reviewed before release for privacy disclosures, data collection, policy risk, security posture, and necessity. Avoid adding SDKs that are not essential.

## Release Compliance Gate

Before any production release, Edvora must run a Release Compliance Gate covering:

- Privacy policy and disclosures.
- Data Safety/App Privacy answers.
- Account deletion readiness.
- Reviewer/demo access.
- Permission inventory.
- SDK inventory and privacy manifests where applicable.
- Authentication and access policy compatibility.
- Copyright/content rights.
- Production stability.
- Accurate metadata and screenshots.
- Confirmation that V1 has no student in-app digital content purchase flow.

The gate must be reviewed before release, but it cannot guarantee store approval.
