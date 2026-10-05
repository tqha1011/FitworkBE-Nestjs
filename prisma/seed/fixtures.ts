import { createHash } from 'node:crypto';

// UUIDv5 in a fixed namespace: stable across machines and repeated seed runs.
const namespace = Buffer.from('52cd5b4731b64e3482e97ad82d4acfb1', 'hex');

export function fixtureId(key: string): string {
  const bytes = createHash('sha1')
    .update(namespace)
    .update(`fitwork:demo:v1:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const specialties = [
  {
    name: 'Backend Development',
    title: 'Backend Engineer',
    skills: ['Node.js', 'NestJS', 'PostgreSQL'],
  },
  {
    name: 'Frontend Development',
    title: 'Frontend Engineer',
    skills: ['React', 'TypeScript', 'Tailwind CSS'],
  },
  {
    name: 'Mobile Development',
    title: 'Mobile Engineer',
    skills: ['Flutter', 'Dart', 'Firebase'],
  },
  {
    name: 'Data Engineering',
    title: 'Data Engineer',
    skills: ['Python', 'Pandas', 'Apache Spark'],
  },
  {
    name: 'Cloud Infrastructure',
    title: 'Cloud Engineer',
    skills: ['Docker', 'Kubernetes', 'Terraform'],
  },
  {
    name: 'Product Design',
    title: 'Product Designer',
    skills: ['Figma', 'User Research', 'Prototyping'],
  },
  {
    name: 'Quality Assurance',
    title: 'QA Engineer',
    skills: ['Playwright', 'Jest', 'Test Planning'],
  },
  {
    name: 'Cybersecurity',
    title: 'Security Consultant',
    skills: ['OWASP', 'Penetration Testing', 'Threat Modeling'],
  },
  {
    name: 'Digital Marketing',
    title: 'Marketing Specialist',
    skills: ['SEO', 'Google Analytics', 'Content Strategy'],
  },
  {
    name: 'Business Analysis',
    title: 'Business Analyst',
    skills: ['Requirements Analysis', 'Stakeholder Management', 'BPMN'],
  },
] as const;

export const arrangementNames = ['On-site', 'Remote', 'Hybrid'] as const;
const locations = ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng'];
const surnames = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Vũ',
  'Đặng',
  'Bùi',
  'Đỗ',
  'Hồ',
];
const givenNames = ['Minh Anh', 'Quang Huy', 'Thảo Linh', 'Đức Nam', 'Ngọc Hà'];
const companyNames = [
  'Sen Việt',
  'Sông Hồng',
  'Biển Xanh',
  'Mây Việt',
  'Tre Việt',
  'Sao Mai',
  'Cửu Long',
  'Hải Âu',
  'Ánh Dương',
  'Đông Phương',
];

function account(kind: 'company' | 'applicant', number: number) {
  const key = `${kind}:${number}`;
  return {
    key,
    publicId: fixtureId(`user:${key}`),
    email: `${kind}${String(number).padStart(2, '0')}@seed.fitwork.test`,
    username: `seed_${kind}_${String(number).padStart(2, '0')}`,
    location: locations[(number - 1) % locations.length],
  };
}

export const companies = companyNames.map((companyName, index) => ({
  ...account('company', index + 1),
  fullName: `${surnames[index]} ${givenNames[index % givenNames.length]}`,
  companyName: `${companyName} Digital`,
  specialty: index,
}));

export const applicants = Array.from({ length: 50 }, (_, index) => {
  const number = index + 1;
  const specialty = index % specialties.length;
  const fullName = `${surnames[specialty]} ${givenNames[Math.floor(index / 10)]}`;
  const user = account('applicant', number);
  const experienceYears = 3 + Math.floor(index / 10);
  const skills = specialties[specialty].skills;
  const text = [
    fullName,
    `Email: ${user.email}`,
    `Phone: +84 900 ${String(number).padStart(3, '0')} 000`,
    `Address: ${number} Demo Street, ${user.location}, Vietnam`,
    `Portfolio: https://applicant${number}.seed.fitwork.test`,
    '',
    'Professional Summary',
    `${specialties[specialty].title} with ${experienceYears} years of professional experience delivering reliable products for Vietnamese businesses.`,
    '',
    'Skills',
    skills.join(', '),
    '',
    'Work Experience',
    `2022-present: ${specialties[specialty].title} at Demo Product Studio.`,
    `Delivered production features using ${skills[0]} and ${skills[1]}; improved delivery time by 20% through review and clear documentation.`,
    `2020-2022: Associate at Demo Services. Applied ${skills[2]} in client projects and collaborated with a team of six.`,
    '',
    'Projects',
    `Customer Portal: led a three-month project using ${skills[0]}, ${skills[1]} and ${skills[2]}. Delivered milestones on schedule and documented handover.`,
    '',
    'Education',
    '2016-2020: Bachelor degree, Demo Vietnam University. Coursework in quantitative methods, communication and project management.',
    '',
    'Languages',
    'Vietnamese (native), English (professional working proficiency).',
  ].join('\n');
  const fullSlot = [1, 3, 5][Math.floor(index / 10) % 3];
  const partialSlot = [2, 4][Math.floor(index / 10) % 2];
  return {
    ...user,
    fullName,
    specialty,
    experienceYears,
    skills,
    text,
    resumePublicId: fixtureId(`resume:${user.key}`),
    contentPublicId: fixtureId(`resume-content:${user.key}`),
    storagePath: `seed/demo/${user.publicId}/resume.pdf`,
    jobKeys: [
      `job:${specialty + 1}:${fullSlot}`,
      `job:${specialty + 1}:${partialSlot}`,
      `job:${((specialty + 2) % 10) + 1}:${fullSlot}`,
    ],
  };
});

export const jobs = companies.flatMap((company, companyIndex) =>
  Array.from({ length: 6 }, (_, slotIndex) => {
    const slot = slotIndex + 1;
    const specialty = specialties[companyIndex];
    const next = specialties[(companyIndex + 1) % specialties.length];
    const skills =
      slot === 2 || slot === 4
        ? [specialty.skills[2], next.skills[0], next.skills[1]]
        : [...specialty.skills];
    const key = `job:${companyIndex + 1}:${slot}`;
    const currency: 'VND' | 'USD' = slot % 2 === 0 ? 'USD' : 'VND';
    return {
      key,
      publicId: fixtureId(key),
      companyKey: company.key,
      title: `${specialty.title} — ${slot === 6 ? 'Archived' : `Project ${slot}`}`,
      description: `Help ${company.companyName} deliver a customer platform. Own a defined milestone, communicate progress weekly, and provide tested deliverables and handover documentation.`,
      requirements: `At least 3 years of relevant experience. Demonstrated use of ${skills.join(', ')}. Clear written English, collaboration, and reliable delivery within 30 days.`,
      location: company.location,
      status: slot === 6 ? ('CLOSED' as const) : ('OPEN' as const),
      budget:
        currency === 'USD' ? 1_500 + slot * 100 : 30_000_000 + slot * 2_000_000,
      currency,
      specialty: companyIndex,
      arrangement: arrangementNames[(companyIndex + slotIndex) % 3],
      skills,
    };
  }),
);
