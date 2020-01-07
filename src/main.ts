import * as core from '@actions/core'
import AWS from 'aws-sdk'
import path from 'path'
import fs from 'fs'

async function run(): Promise<void> {
  try {
    const region: string = core.getInput('aws-region', {required: true})
    const clusterName: string = core.getInput('aws-cluster-name', {
      required: true
    })
    const serviceName: string = core.getInput('aws-service-name', {
      required: true
    })
    const imageTag: string = core.getInput('docker-image', {required: true})
    const appEnv: string = core.getInput('app-env', {required: true})
    const dockerBuildNumber: string = core.getInput('docker-build-number', {
      required: true
    })
    const gitSha = process.env.GITHUB_SHA || 'unknown'

    const ECS = new AWS.ECS({
      region,
      customUserAgent: 'amazon-ecs-deploy-task-definition-for-github-actions'
    })
    const res = await ECS.describeServices({
      cluster: clusterName,
      services: [serviceName]
    }).promise()
    if (!(res.services && res.services.length > 0)) {
      core.warning(JSON.stringify(res))
      throw new Error(`no services`)
    }
    const service = res.services[0]
    const currentTaskDefinitionArn = service.taskDefinition
    if (!currentTaskDefinitionArn) {
      core.warning(JSON.stringify(res))
      throw new Error(`no currentTaskDefinitionArn`)
    }
    const res1 = await ECS.describeTaskDefinition({
      taskDefinition: currentTaskDefinitionArn
    }).promise()
    core.debug(
      `Service ${service.serviceName} is currently running: ARN: ${currentTaskDefinitionArn}`
    )
    const taskDefinition = res1.taskDefinition
    if (!taskDefinition) {
      core.warning(JSON.stringify(res1))
      throw new Error(`no taskDefinition`)
    }
    const containerDefinitions = taskDefinition.containerDefinitions || []
    const containerDefinitionNames = containerDefinitions.map(def => def.name)
    core.debug(
      `Container Definitions names: ${containerDefinitionNames.join(', ')}`
    )
    const containerDefinitionsWithNames = containerDefinitions.filter(
      def => !!def.name
    )
    const firstContainerDefinition =
      containerDefinitionsWithNames.length && containerDefinitionsWithNames[0]
    if (!firstContainerDefinition || !firstContainerDefinition.name) {
      core.warning(JSON.stringify(res1))
      throw new Error(`no firstContainerDefinition (with name)`)
    }
    core.debug(
      `Task Definition ${taskDefinition.taskDefinitionArn} is currently running ${firstContainerDefinition.image} `
    )

    // Set the new image on the task definition
    firstContainerDefinition.image = imageTag

    const replaceEnvNames = ['DOCKER_BUILD', 'GIT_REVISION']
    const containerDefEnvVars =
      firstContainerDefinition.environment || ([] as never[])
    const environment = containerDefEnvVars.filter(
      env => !replaceEnvNames.includes(env.name || '')
    )

    environment.push({
      name: 'GIT_REVISION',
      value: gitSha
    })

    environment.push({
      name: 'DOCKER_BUILD',
      value: `${appEnv}-${dockerBuildNumber}`
    })

    firstContainerDefinition.environment = environment

    // There are certain attributes that AWS does not expect to receive back in.
    delete taskDefinition.compatibilities
    delete taskDefinition.requiresAttributes
    delete taskDefinition.status
    delete taskDefinition.revision
    delete taskDefinition.taskDefinitionArn

    // Write out a new task definition file
    const filePath = path.join(
      process.env.RUNNER_TEMP ||
        process.env.GITHUB_WORKSPACE ||
        process.env.PWD ||
        '',
      `task-definition-${gitSha}.json`
    )
    const newTaskDefContents = JSON.stringify(taskDefinition, null, 2)
    fs.writeFileSync(filePath, newTaskDefContents)
    core.setOutput('task-definition', filePath)
    core.setOutput(
      'container-definition-name',
      containerDefinitionNames.join(',')
    )
    core.setOutput(
      'first-container-definition-name',
      firstContainerDefinition.name
    )
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
