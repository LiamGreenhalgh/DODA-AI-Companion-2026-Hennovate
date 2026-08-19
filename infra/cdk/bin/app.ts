#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { loadPreviewConfiguration } from '../src/config.js';
import { RegistryStack } from '../src/registry-stack.js';
import { ServiceStack } from '../src/service-stack.js';

const configuration = loadPreviewConfiguration(process.env);
const app = new App();
const environment = { account: configuration.account, region: configuration.region };

const stack =
  configuration.stage === 'registry'
    ? new RegistryStack(app, `DelawareScenePreviewRegistry-${configuration.environmentName}`, {
        stackName: `DelawareScene-Preview-Registry-${configuration.environmentName}`,
        env: environment,
        description: 'Retained ECR repository and bounded CodeBuild project for the Hennovate preview.',
        terminationProtection: true,
        configuration,
      })
    : new ServiceStack(app, `DelawareScenePreviewService-${configuration.environmentName}`, {
        stackName: `DelawareScene-Preview-Service-${configuration.environmentName}`,
        env: environment,
        description: 'Single-task ECS Fargate and CloudFront production preview for Hennovate.',
        terminationProtection: false,
        configuration: { ...configuration, imageUri: configuration.imageUri! },
      });

Tags.of(stack).add('Application', 'Hennovate');
Tags.of(stack).add('Environment', configuration.environmentName);
Tags.of(stack).add('ManagedBy', 'AWS-CDK');
Tags.of(stack).add('DeploymentTier', 'production-preview');

app.synth();
