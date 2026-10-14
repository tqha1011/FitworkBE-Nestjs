// Small, session-scoped scenario adapted from prisma/seed/fixtures.ts.
export const demoCandidates = [
  {
    name: 'Nguyen Minh Anh',
    key: 'strong',
    skills: ['Node.js', 'NestJS', 'PostgreSQL'],
    text: 'Nguyen Minh Anh\nEmail: minh.anh@example.invalid\n\nProfessional Summary\nBackend Engineer with 5 years of professional experience.\n\nSkills\nNode.js, NestJS, PostgreSQL\n\nWork Experience\nBuilt reliable APIs using Node.js and NestJS.\nDesigned PostgreSQL databases, indexes and transactions.\n\nProjects\nCustomer Portal: delivered a production platform with a team of six.\n\nEducation\nBachelor degree in Computer Science, Demo Vietnam University.',
  },
  {
    name: 'Tran Quang Huy',
    key: 'partial',
    skills: ['Node.js', 'React', 'TypeScript'],
    text: 'Tran Quang Huy\nEmail: quang.huy@example.invalid\n\nProfessional Summary\nFrontend Engineer with 3 years of professional experience.\n\nSkills\nNode.js, React, TypeScript\n\nWork Experience\nBuilt React dashboards and a small Node.js API.\nCollaborated with designers on accessible user interfaces.\n\nProjects\nCustomer Portal: delivered frontend features and documented handover.\n\nEducation\nBachelor degree in Computer Science, Demo Vietnam University.',
  },
  {
    name: 'Le Thao Linh',
    key: 'gap',
    skills: ['Figma', 'User Research', 'Prototyping'],
    text: 'Le Thao Linh\nEmail: thao.linh@example.invalid\n\nProfessional Summary\nProduct Designer with 4 years of professional experience.\n\nSkills\nFigma, User Research, Prototyping\n\nWork Experience\nDesigned customer journeys and conducted usability interviews.\nCreated interactive prototypes and documented design decisions.\n\nProjects\nCustomer Portal: led product discovery and design handover.\n\nEducation\nBachelor degree in Design, Demo Vietnam University.',
  },
] as const;

export const demoJobs = [
  {
    title: 'Backend Engineer — Customer Portal',
    skills: ['Node.js', 'NestJS', 'PostgreSQL'],
    category: 'Backend Development',
  },
  {
    title: 'Frontend Engineer — Dashboard',
    skills: ['React', 'TypeScript', 'Tailwind CSS'],
    category: 'Frontend Development',
  },
  {
    title: 'Mobile Engineer — Customer App',
    skills: ['Flutter', 'Dart', 'Firebase'],
    category: 'Mobile Development',
  },
] as const;
