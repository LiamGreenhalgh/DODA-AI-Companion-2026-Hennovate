import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { PreviewConfiguration } from './config.js';

export interface ServiceStackProps extends StackProps {
  configuration: PreviewConfiguration & { imageUri: string };
}

export class ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const { configuration } = props;
    const vpc = new ec2.Vpc(this, 'PreviewVpc', {
      maxAzs: 2,
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: 'PublicApplication', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    const cluster = new ecs.Cluster(this, 'PreviewCluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = new logs.LogGroup(this, 'WebLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WebTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const [repositoryUri, imageDigest] = configuration.imageUri.split('@') as [string, string];
    const repositoryName = repositoryUri.slice(repositoryUri.indexOf('/') + 1);
    const repository = ecr.Repository.fromRepositoryName(this, 'PreviewRepository', repositoryName);
    const container = taskDefinition.addContainer('WebContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageDigest),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'web' }),
      environment: {
        HOST: '0.0.0.0',
        PORT: '3000',
        DATA_DIRECTORY: '/app/data/generated',
        DEMO_MODE: 'false',
        RELEASE_VERSION: configuration.releaseVersion,
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          "node -e \"fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(20),
      },
    });
    container.addPortMappings({ containerPort: 3000, protocol: ecs.Protocol.TCP });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'PreviewWebService', {
      cluster,
      taskDefinition,
      publicLoadBalancer: true,
      assignPublicIp: true,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      listenerPort: 80,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(90),
    });
    service.targetGroup.configureHealthCheck({
      path: '/api/v1/health/ready',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
    });

    const distribution = new cloudfront.Distribution(this, 'PreviewDistribution', {
      comment: `Hennovate ${configuration.environmentName} production preview`,
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          connectionTimeout: Duration.seconds(10),
          readTimeout: Duration.seconds(60),
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    container.addEnvironment('PUBLIC_ORIGIN', `https://${distribution.distributionDomainName}`);

    new CfnOutput(this, 'WebsiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'LoadBalancerDnsName', { value: service.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: service.service.serviceName });
  }
}
