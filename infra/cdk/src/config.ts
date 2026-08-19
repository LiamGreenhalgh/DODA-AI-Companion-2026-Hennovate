const ACCOUNT_ID = /^\d{12}$/u;
const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{0,19}$/u;
const RELEASE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST_IMAGE = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;

export type DeploymentStage = 'registry' | 'service';

export interface PreviewConfiguration {
  account: string;
  region: string;
  environmentName: string;
  stage: DeploymentStage;
  releaseVersion: string;
  sourceKey: string;
  imageUri?: string;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function loadPreviewConfiguration(environment: NodeJS.ProcessEnv): PreviewConfiguration {
  const account = required(environment, 'EXPECTED_AWS_ACCOUNT_ID');
  const region = required(environment, 'AWS_REGION');
  const environmentName = required(environment, 'ENVIRONMENT_NAME');
  const stageInput = required(environment, 'DEPLOYMENT_STAGE');
  const releaseVersion = required(environment, 'RELEASE_VERSION');
  const sourceKey = environment.SOURCE_KEY?.trim() || `source/${releaseVersion}.zip`;

  if (!ACCOUNT_ID.test(account)) throw new Error('EXPECTED_AWS_ACCOUNT_ID must be exactly 12 digits.');
  if (!ENVIRONMENT_NAME.test(environmentName)) {
    throw new Error('ENVIRONMENT_NAME must start with a lowercase letter and contain at most 20 lowercase letters, digits, or hyphens.');
  }
  if (stageInput !== 'registry' && stageInput !== 'service') {
    throw new Error('DEPLOYMENT_STAGE must be registry or service.');
  }
  if (!RELEASE_VERSION.test(releaseVersion)) {
    throw new Error('RELEASE_VERSION must contain 1-128 safe release identifier characters.');
  }
  if (sourceKey.startsWith('/') || sourceKey.includes('..') || !sourceKey.endsWith('.zip')) {
    throw new Error('SOURCE_KEY must be a relative .zip object key without parent traversal.');
  }

  const imageUri = environment.IMAGE_URI?.trim();
  if (stageInput === 'service' && (!imageUri || !DIGEST_IMAGE.test(imageUri))) {
    throw new Error('IMAGE_URI is required for the service stage and must be an ECR URI pinned by sha256 digest.');
  }

  return {
    account,
    region,
    environmentName,
    stage: stageInput,
    releaseVersion,
    sourceKey,
    ...(imageUri ? { imageUri } : {}),
  };
}
