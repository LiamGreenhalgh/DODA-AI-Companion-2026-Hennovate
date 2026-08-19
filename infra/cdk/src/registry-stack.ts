import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { PreviewConfiguration } from './config.js';

export interface RegistryStackProps extends StackProps {
  configuration: PreviewConfiguration;
}

export class RegistryStack extends Stack {
  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);

    const { configuration } = props;
    const repository = new ecr.Repository(this, 'PreviewRepository', {
      repositoryName: `delaware-scene-preview-${configuration.environmentName}`,
      encryption: ecr.RepositoryEncryption.AES_256,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ maxImageCount: 10, description: 'Retain the ten most recent preview images' }],
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });

    const sourceBucket = new s3.Bucket(this, 'BuildSourceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const project = new codebuild.Project(this, 'ContainerBuildProject', {
      projectName: `delaware-scene-preview-${configuration.environmentName}`,
      description: 'Builds the Hennovate preview image when no local container runtime is available.',
      source: codebuild.Source.s3({ bucket: sourceBucket, path: configuration.sourceKey }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          REPOSITORY_URI: { value: repository.repositoryUri },
          RELEASE_VERSION: { value: configuration.releaseVersion },
        },
      },
      timeout: Duration.minutes(30),
      queuedTimeout: Duration.minutes(30),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'aws --version',
              'docker --version',
              'aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "${REPOSITORY_URI%/*}"',
            ],
          },
          build: {
            commands: [
              'docker build --pull --build-arg "RELEASE_VERSION=$RELEASE_VERSION" -t "$REPOSITORY_URI:$RELEASE_VERSION" .',
              'docker push "$REPOSITORY_URI:$RELEASE_VERSION"',
            ],
          },
          post_build: {
            commands: [
              'aws ecr describe-images --repository-name "${REPOSITORY_URI##*/}" --image-ids "imageTag=$RELEASE_VERSION" --query "imageDetails[0].imageDigest" --output text',
            ],
          },
        },
      }),
    });

    sourceBucket.grantRead(project);
    repository.grantPullPush(project);
    repository.grant(project, 'ecr:DescribeImages');

    new CfnOutput(this, 'RepositoryUri', { value: repository.repositoryUri });
    new CfnOutput(this, 'SourceBucketName', { value: sourceBucket.bucketName });
    new CfnOutput(this, 'SourceObjectKey', { value: configuration.sourceKey });
    new CfnOutput(this, 'BuildProjectName', { value: project.projectName });
  }
}
